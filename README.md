# CASP BYOW Ethereum JavaScript Demo

This is a terminal application that shows how to use CASP(Crypto Asset Management Platform) API from an external Ethereum wallet for creating and signing transaction.   
BYOW = Bring Your Own Wallet.

## Overview
This demo shows the following:
- **Connecting to CASP**   
How to connect to CASP and authenticate with Bearer token
- **Accounts and Participants**   
- **Vaults**   
How to create a Vault and activate it by joining a participant   
- **Generating Ethereum address**   
How to use CASP for generating new ECDSA key-pair and use it for generating new Ethereum address
- **Deposit**   
How to poll an address for balance with web3
- **Withdrawal**   
How to create an Ethereum transaction for withdrawing funds from a CASP generated address
- **Signature**   
How to request a signature approval from Vault participants and use the signature  
to sign the Eth transaction
- **Send transaction to ledger**

## Usage
### Requirements
* Functional CASP server
* An Infura Token (get it from [here](https://infura.io))
* Node JS LTS

### Installation
* Get the source code   
```$ git clone https://github.com/unbound-tech/CASP-BYOW-JS-Demo.git```
* Install dependencies   
```
$ cd CASP-BYOW-JS-Demo
$ npm install
```
* Run the demo
```
$ npm start
```
