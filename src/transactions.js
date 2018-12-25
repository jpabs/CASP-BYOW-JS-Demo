"use strict";
const inquirer = require('inquirer');
const asn1js = require('asn1js');
const EthUtil = require('ethereumjs-util');
const Web3 = require('web3');
const EthereumTx = require('ethereumjs-tx');
const chainId = 3; //eth-ropsten
const util = require('./util');
const Promise = require('bluebird');

var web3;

function addressFromPublicKey(rawEcPubKey) {
  if(rawEcPubKey.length === 65) {
    // remove prefix
    rawEcPubKey = rawEcPubKey.slice(1);
  }
  if(!EthUtil.isValidPublic(rawEcPubKey)) throw "Invalid public key";
  const address = EthUtil.pubToAddress(rawEcPubKey);
  return `0x${address.toString('hex')}`;
}

function getRawEcPublicKeyFromDerHex(publicKeyDerHexString) {
  const pkDerBuf = Buffer.from(publicKeyDerHexString, 'hex');
  const arrayBuffer = new ArrayBuffer(pkDerBuf.length);
  const uint8Array = new Uint8Array(arrayBuffer);
  for(let i = 0; i < pkDerBuf.length; i++) uint8Array[i] = pkDerBuf[i];
  const asn = asn1js.fromBER(arrayBuffer.slice(0));
  var hex = asn.result.valueBlock.value[1].valueBlock.valueHex;
  return Buffer.from(hex);
}

//caspMngUrl
async function createAddress(options) {
  const vault = options.activeVault;
  const isBip44 = vault.hierarchy === 'BIP44';
  var coinId = 60; // ETH - this was set on vault creation
  util.log('Generating public key with CASP');
  var publicKeyDER = (await util.superagent.post(`${options.caspMngUrl}/vaults/${vault.id}/coins/${coinId}/accounts/0/chains/external/addresses`))
                      .body.publicKey;

  // extract the raw EC public key bytes from DER encoded public key
  var publicKeyRaw = getRawEcPublicKeyFromDerHex(publicKeyDER);

  // convert to Ethereum address
  var address = addressFromPublicKey(publicKeyRaw);
  util.log(`Generated address: ${address}`)
  return {
    address: address,
    publicKeyDER: publicKeyDER,
    publicKeyRaw: publicKeyRaw.toString('hex')
  };
}

//options.infuraUrl
//options.addressInfo.address
async function waitForDeposit(options) {
  var web3 = new Web3(options.infuraUrl);
  var address = options.addressInfo.address;
  // wait for deposit
  util.showSpinner(`Waiting for deposit to ${address}`);
  var balance = BigInt(0);
  try {
    do {
      balance = await web3.eth.getBalance(address);
      balance = BigInt(balance);
      await Promise.delay(500)
    } while(balance === BigInt(0));
    util.hideSpinner();
    util.log(`Using address: ${address}`)
    util.log(`Balance is: ${web3.utils.fromWei(balance.toString(), 'ether')} Ether`);
    return balance.toString();
  } catch(e) {
    util.hideSpinner();
    util.logError(e);
  }
}

async function createTransaction(options) {
  var web3 = new Web3(options.infuraUrl);
  var amount = BigInt(options.addressInfo.balance);
  var gasPrice = BigInt(await web3.eth.getGasPrice());
  // use last used recipient
  var recipientAddress = options.pendingTransaction
      && (options.pendingTransaction.txData || {}).to ;
  var transactionData = {
    from: options.addressInfo.address,
    to: (await inquirer.prompt([{name: 'to', validate: util.required('To address'),
            message: 'To address: ', default: recipientAddress }])).to
  };
  var gasLimit = BigInt(await web3.eth.estimateGas({
    to: transactionData.to,
    value: amount.toString()
  }));
  // calculate max transfer amount
  // var maxTransferAmount = BigInt(amount) - BigInt(gasLimit) * BigInt(gasPrice);
  // var amountToTransfer = await inquirer.prompt([{
  //   name: 'amount', message: 'Amount: ', default: maxTransferAmount, validate: util.required(amountToTransfer)
  // }])
  var nonce = await web3.eth.getTransactionCount(transactionData.from, 'pending');
  var toHex = a => '0x' + a.toString(16);
  transactionData = {...transactionData,
    nonce: nonce,
    value: toHex(amount),
    gasPrice: toHex(gasPrice),
    gasLimit: toHex(gasLimit),
    chainId: toHex(chainId)
  }

  var txObj = new EthereumTx(transactionData);
  var cost = BigInt(txObj.getUpfrontCost());
  var gasCost = cost - amount;
  if(gasCost > 0) {
    amount = amount - gasCost;
    transactionData.value = toHex(amount);
    var txObj = new EthereumTx(transactionData);
  }

  return {
    txData: transactionData,
    hashToSign: txObj.hash(false).toString('hex')
  }
}

async function signTransaction(options) {
  var web3 = new Web3(options.infuraUrl);
  const vaultId = options.activeVault.id;
  var pendingTransaction = options.pendingTransaction;
  util.showSpinner('Requesting signature from CASP');
  try {
    var quorumRequestOpId = (await util.superagent.post(`${options.caspMngUrl}/vaults/${vaultId}/sign`)
      .send({
        dataToSign: [
          pendingTransaction.hashToSign
        ],
        publicKeys: [
          options.addressInfo.publicKeyDER
        ],
        description: 'Test transaction Eth',
        // the details are shown to the user when requesting approval
        details: JSON.stringify(pendingTransaction, undefined, 2),
        // callbackUrl: can be used to receive notifictaion when the sign operation
        // is approved
      })).body.operationID;
    util.hideSpinner();
    util.log('Signature process started, signature must be approved by vault participant');
    util.log(`To approve with bot, run: 'java -Djava.library.path=. -jar BotSigner.jar -u http://localhost/casp -p ${options.activeParticipant.id} -w 1234567890`);
    util.showSpinner('Waiting for signature quorum approval');
    var signOp;
    do {
      signOp =(await util.superagent.get(`${options.caspMngUrl}/operations/sign/${quorumRequestOpId}`))
        .body;
      await Promise.delay(500);
    } while(signOp.status !== 'COMPLETED'); //
    util.hideSpinner();
    util.log(`Signature created: ${signOp.signatures[0]}`)

    var signature = signOp.signatures[0];
    var v = signOp.v[0];
    // workaround for CASP pre-November bug
    // starting CASP 11-2018 v is returned as 0 or 1
    if(v === 27) v = 1;
    if(v === 28) v = 0;
    var tx = new EthereumTx(pendingTransaction.txData);
    tx.r = new Buffer.from(signature.slice(0, 64).toLowerCase(), 'hex');
		tx.s = new Buffer.from(signature.slice(64).toLowerCase(), 'hex');
    // According to https://github.com/ethereum/EIPs/blob/master/EIPS/eip-155.md
    tx.v = chainId * 2 + v + 35;
    // validate that the from address decoded from signature is our address
    var fromAddress = pendingTransaction.txData.from;

    if(tx.from.toString('hex').toLowerCase() !== fromAddress.toLowerCase().slice(2)) {
      throw new Error("Failed to sign transaction, invalid v value");
    }
    return {
      signOperation: signOp,
      serializedSignedTransaction: '0x' + tx.serialize().toString('hex')
    }
  } catch(e) {
    util.log(e);
    util.hideSpinner();
    util.logError(e);
  }
}

async function sendTransaction(options) {
  var web3 = new Web3(options.infuraUrl);
  var txHex = options.pendingTransaction.signed;
  util.showSpinner('Sending signed transaction to ledger');
  var res = await web3.eth.sendSignedTransaction(txHex);
  util.hideSpinner();
  return res.transactionHash;
}

module.exports = {
  createAddress,
  waitForDeposit,
  createTransaction,
  signTransaction,
  sendTransaction
}
