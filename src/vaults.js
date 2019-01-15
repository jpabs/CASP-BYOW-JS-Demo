"use strict";
const util = require('./util');
const inquirer = require('inquirer');
const superagent = util.superagent;
const Promise = require('bluebird');

/**
 * Selects an active vault.
 * If there is only one active vault, use it.
 * If there is more than one active vault, try to use last selected vault
 * or let the user choose a vault.
 * If there is no active vault, prompt the user to create a new vault.
 *
 * @param  {Object} options
 * @param  {string} options.caspMngUrl - The URL for CASP management API
 * @param  {Object} options.activeAccount - Details of the active CASP accounts (id, name)
 * @param  {Object} options.activeVault - Details of the CASP vault to use for signature
 * @param  {Object} options.activeParticipant - Details of an active participant
 *                  to use as vault member when creating a new vault
 * @return {Object} Data of the selected vault(id, name etc...)
 */
async function selectActiveVault(options) {
  const vaultsUrl = `${options.caspMngUrl}/accounts/${options.activeAccount.id}/vaults`;
  util.showSpinner('Fetching vaults');
  var vaults = (await superagent.get(vaultsUrl)).body;
  util.hideSpinner();

  vaults = vaults.filter(v => v.isActive);
  // if only one active vault use it,
  // otherwise try to use last selected vault
  var selected = vaults.length === 1 && vaults[0]
            || vaults.find(v => v.id === (options.activeVault || {}).id);

  if(vaults.length && !selected) {
    util.log('Please choose a vault')
    selected = (await inquirer.prompt([
      {name: 'vault', message: 'Vault: ', validate: util.required('Vault')
      , type: 'list', choices: vaults.map(v => ({name: v.name, value: v}))}
    ])).vault;
  } else if(!vaults.length){
    util.log('No active vaults found, please create one');
    var participant = options.activeParticipant;
    while(!selected) {
      selected = await createVault(options);
    }
  }

  util.log(`Using vault '${selected.name}' (${selected.id})`);
  return selected;
}

// options.activeParticipant
// options.activeAccount
// options.caspMngUrl
/**
 * Prompts the user and creates a new vault
 * @param  {Object} options
 * @param  {string} options.caspMngUrl - The URL for CASP management API
 * @param  {Object} options.activeAccount - Details of the active CASP accounts (id, name)
 * @param  {Object} options.activeParticipant - Details of an active participant
 *                  to use as vault member for the new vault
 * @return {Object} Data of the created vault(id, name etc...)
 */
async function createVault(options) {
  var newVault;
  while(!newVault) {
    // prompt user for name and description
    var vaultOptions = await inquirer.prompt([
      {name: 'name', message: "Vault Name: ",
        validate: util.required("Vault Name"), default: "BYOW Eth demo"},
      {name: 'description', message: "Vault Description: ",
        default: 'Test BYOW deposit and withdrawal with Ethereum'}
    ]);
    // add vault attributes for Ethereum
    vaultOptions = {
      ...vaultOptions,
      firstAccountName: 'Default',
      subAccountsToDerive: 1,
      groups: [
        {
          name: 'Group A',
          requiredApprovals: 1,
          members: [
            {
              id: options.activeParticipant.id
            }
          ]
        }
      ],
      cryptoKind: "ECDSA",
      providerKind: "ETH_BYOW",
      hierarchy: 'BIP44',
      coinType: 60 //ETH see: https://github.com/satoshilabs/slips/blob/master/slip-0044.md
    };
    util.showSpinner('Creating vault');
    const vaultsUrl = `${options.caspMngUrl}/accounts/${options.activeAccount.id}/vaults`
    try {
      newVault = (await superagent.post(vaultsUrl)
          .send(vaultOptions)).body;
      util.hideSpinner();
      util.log(`Vault ${newVault.name} created successfully.`);
      util.log(`Vault is not active until participant '${options.activeParticipant.name} joins`);
      util.log(`To join with bot, run: 'java -Djava.library.path=. -jar BotSigner.jar -u http://localhost/casp -p ${options.activeParticipant.id} -w 1234567890'`);

      util.showSpinner('Waiting for participant to join vault')
      try {
        while(newVault.status !== 'INITIALIZED') {
          await Promise.delay(500);
          newVault = (await superagent.get(`${options.caspMngUrl}/vaults/${newVault.id}`)).body;
        }
        util.hideSpinner();
      } catch(e) {
        util.hideSpinner();
        util.logError(e);
        newVault = undefined;
      }
    } catch(e) {
      util.logError(e, 'Vault creation failed');
      newVault = undefined;
    }
  } // while(!newVault)
  return newVault;
}


module.exports = {
  selectActiveVault
}
