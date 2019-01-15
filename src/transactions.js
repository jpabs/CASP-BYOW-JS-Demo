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


/**
 * Create an Ethereum address from a raw EC public key buffer.
 *
 * @param  {Buffer} rawEcPubKey - raw bytes of the EC public key
 * @return {string} An Ethereum address
 */
function addressFromPublicKey(rawEcPubKey) {
  if(rawEcPubKey.length === 65) {
    // remove prefix
    rawEcPubKey = rawEcPubKey.slice(1);
  }
  if(!EthUtil.isValidPublic(rawEcPubKey)) throw "Invalid public key";
  const address = EthUtil.pubToAddress(rawEcPubKey);
  return `0x${address.toString('hex')}`;
}


/**
 * Extract raw public key bytes from DER encoded EC public key.
 * CASP returns genrated keys in DER format, so we need to extract the relevant
 * data for address generation.
 *
 * @param  {string} publicKeyDerHexString - DER hex-encoded ECDSA public key from CASP
 * @return {Buffer} a buffer with byte data of the public key
 */
function getRawEcPublicKeyFromDerHex(publicKeyDerHexString) {
  const pkDerBuf = Buffer.from(publicKeyDerHexString, 'hex');
  const arrayBuffer = new ArrayBuffer(pkDerBuf.length);
  const uint8Array = new Uint8Array(arrayBuffer);
  for(let i = 0; i < pkDerBuf.length; i++) uint8Array[i] = pkDerBuf[i];
  const asn = asn1js.fromBER(arrayBuffer.slice(0));
  var hex = asn.result.valueBlock.value[1].valueBlock.valueHex;
  return Buffer.from(hex);
}

/**
 * Creates a new BIP44 Ethereum address with CASP
 *
 * @param  {Object} options
 * @param  {string} options.caspMngUrl - The URL of CASP management API
 * @param  {Object} options.activeVault - Details of the last selected vault(id, name)
 * @return {Object} Address information for the generated Ethereum address,
 * includes the address, DER encoded public key and hex encoded raw public key bytes
 */
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

/**
 * Waits until funds are deposited for address
 * Uses web3.js
 * @param  {Object} options
 * @param  {string} options.infuraUrl - URL for Infura ledger server
 * @param  {Object} options.addressInfo - Information for the requested address(address)
 * @return {string} The balance as string
 */
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

/**
 * Creates an Ethereum transaction
 * Uses web3.js
 * @param  {Object} options
 * @param  {string} options.caspMngUrl - The URL for CASP management API
 * @param  {string} options.infuraUrl - URL for Infura ledger server
 * @param  {Object} options.addressInfo - Information of the address to withdraw from (address, publicKeyDER )
 * @return {Object} Details of the created transaction including the parameters
 *                  that were used to create it and the transaction hash for signature
 */
async function createTransaction(options) {
  var web3 = new Web3(options.infuraUrl);
  var amount = BigInt(options.addressInfo.balance);
  var gasPrice = BigInt(await web3.eth.getGasPrice());
  var transactionData = {
    from: options.addressInfo.address,
    to: (await inquirer.prompt([{name: 'to', validate: util.required('To address'),
            message: 'To address: ' }])).to
  };
  var gasLimit = BigInt(await web3.eth.estimateGas({
    to: transactionData.to,
    value: amount.toString()
  }));
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

/**
 * Sign a transaction with CASP
 * @param  {Object} options
 * @param  {string} options.caspMngUrl - The URL for CASP management API
 * @param  {string} options.infuraUrl - URL for Infura ledger server
 * @param  {Object} options.activeVault - Details of the CASP vault to use for signature
 * @param  {Object} options.addressInfo - Information of the address that is the
 *                  source(from) of the transaction (address, publicKeyDER )
 * @param  {Object} options.pendingTransaction - Details of the transaction to sign,
 *                  including: hashToSign and txData
 * @return {Object} Signature data with:
 *                  signOperation - details of the CASP signature quorum operation
 *                  serializedSignedTransaction - serialized signed transaction that can be sent to the ledger
 */
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
    util.log(`To approve with bot, run: 'java -Djava.library.path=. -jar BotSigner.jar -u http://localhost/casp -p ${options.activeParticipant.id} -w 1234567890'`);
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

/**
 * Sends a signed transaction to Infura ledger
 * @param  {Object} options
 * @param  {string} options.infuraUrl - URL for Infura ledger server
 * @param  {string} options.pendingTransaction.signed - serialized signed transaction that can be sent to the ledger
 * @return {string} transaction hash of the sent transaction
 */
async function sendTransaction(options) {
  var web3 = new Web3(options.infuraUrl);
  var txHex = options.pendingTransaction.signed;
  util.showSpinner('Sending signed transaction to ledger');
  var res = await web3.eth.sendSignedTransaction(txHex);
  util.hideSpinner();
  util.log(`Transaction sent successfully, txHash is: ${res.transactionHash}`);
  return res.transactionHash;
}

module.exports = {
  createAddress,
  waitForDeposit,
  createTransaction,
  signTransaction,
  sendTransaction
}
