var CASP_API_BASE;
const inquirer = require('inquirer');
const util = require('./util');
const superagent = util.superagent;
const fs = require('fs');
const Promise = require('bluebird');
const Web3 = require('web3');
const qrcode = require('qrcode-terminal');

// Use locally saved data from previous executions.
// For example, if we already created a vault, use it and don't create again.
// The current execution data is saved at the end.
// To reset, dataFile can be deleted before the next execution.

var appData = {};

// disable certificate validation to allow self-signed certificates used by CASP
process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;

async function test() {
  try {
    var appData = await init();
    util.log();
    appData.caspMngUrl = `${appData.caspUrl}/casp/api/v1.0/mng`;

    var login = require('./login');
    var caspCredentials = await login(appData);
    save({caspCredentials});

    var accounts = require('./accounts');
    var activeAccount = await accounts.selectActiveAccount(appData);
    save({activeAccount});

    var participants = require('./participants');
    var activeParticipant = await participants.selectParticipant(appData);
    save({activeParticipant});

    var vaults = require('./vaults');
    var activeVault = await vaults.selectActiveVault(appData);
    save({activeVault});

    var transactions = require('./transactions');
    var addressInfo = appData.addressInfo || await transactions.createAddress(appData);
    save({addressInfo});

    addressInfo.balance = await transactions.waitForDeposit(appData);
    save({addressInfo});

    var pendingTransaction = appData.pendingTransaction || await transactions.createTransaction(appData);
    save({pendingTransaction});

    if(!pendingTransaction.signed) {
      var signInfo = await transactions.signTransaction(appData);
      save({signOperation: signInfo.signOperation});
      pendingTransaction.signed = signInfo.serializedSignedTransaction;
      save({pendingTransaction});
    }

    pendingTransaction.transactionHash = pendingTransaction.transactionHash
          || await transactions.sendTransaction(appData);
    save({pendingTransaction});
  } catch(e) {
    util.logError(e);
    console.log(e);
  }
}


/**
 * Initialize and verify connection to CASP server and Infura ledger server
 */
async function init() {
  try {
    appData = require('../data/data');
  } catch(e) {}

  var caspUrl;
  while(!caspUrl) {
    caspUrl = appData.caspUrl || (await inquirer.prompt([{name:'url', message: 'CASP URL: ',
        default: 'https://localhost', validate: util.required('CASP URL')}])).url;
    CASP_API_BASE = `${caspUrl}/casp/api/v1.0/mng`;
    try {
      util.showSpinner('Connecting to CASP');
      var result = await superagent.get(`${CASP_API_BASE}/status`)
           .query({ withDetails: true });
      util.hideSpinner();
      util.log(`Connected to CASP at ${caspUrl}`)
      util.log(result.body);
      appData.caspUrl = caspUrl;
      save();
    } catch(e) {
      util.hideSpinner();
      util.logError(e);
      util.log(`Could not connect to CASP at '${caspUrl}'. Please check that the URL is correct`);
      caspUrl = undefined;
    }
  }

  var infuraToken;
  var web3;
  while(!web3) {
    infuraToken = appData.infuraToken || (await inquirer.prompt([{name:'token', message: `Infura Token (get it from 'https://infura.io): `,
        validate: util.required('Infura token')}])).token;
    var infuraUrl = `https://ropsten.infura.io/v3/${infuraToken}`;
    web3 = new Web3(infuraUrl);
    try {
      util.showSpinner('Connecting to infura')
      var net = await web3.eth.net.getNetworkType();
      util.hideSpinner();
      util.log(`Connected to Infura-${net}`);
    } catch(e) {
      util.hideSpinner();
      util.log(`Could not connect to Infura, please try again: ${e.message}`);
      web3 = undefined;
    }
  }
  appData.infuraToken = infuraToken;
  appData.infuraUrl = infuraUrl;
  save();
  return appData;
}


/**
 * Saves data between app sessions
 *
 * @param  {type} data - optional, data to append to appData
 */
function save(data) {
  if(data) {
    Object.assign(appData, data);
  }
  if (!fs.existsSync('./data')){
    fs.mkdirSync('./data');
  }
  fs.writeFileSync('./data/data.json', JSON.stringify(appData, undefined, 2));
}

module.exports = test;
