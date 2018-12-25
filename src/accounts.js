"use strict";
const inquirer = require('inquirer');
const util = require('./util');
const superagent = util.superagent;

// caspMngUrl
// activeAccount
async function selectActiveAccount(options) {
  util.showSpinner('Fetching accounts');
  const accounts = (await superagent.get(`${options.caspMngUrl}/accounts`)).body;
  util.hideSpinner();
  var account = accounts[0];
  if(accounts.length > 1) {
    // try to use last selected account
    account = accounts.find(a => a.id === (options.activeAccount || {}).id);
    if(!account) {
      //let the user choose an account
      var answers = await inquirer.prompt([{
        name: 'account', message: 'Choose account:', type: 'list',
        choices: accounts.map((p, i) => ({...p, value: p})),
        validate: util.required('Account')
      }]);
      account = answers.account;
    }
  } else if(!accounts.length) {
    util.log('No accounts found, please create one');
    var answers = await inquirer.prompt([{
      name: 'name', message: 'Account Name:',
      default: 'Test',
      validate: util.required('Account Name')}]);
    util.showSpinner('Creating account');
    try {
      account = (await superagent.post(`${options.caspMngUrl}/accounts`)
        .send(answers)).body;
      util.hideSpinner();
    } catch(e) {
      util.logError(e);
    }
  }
  util.log(`Using account '${account.name}'`);
  return account;
}

module.exports = {
  selectActiveAccount
}
