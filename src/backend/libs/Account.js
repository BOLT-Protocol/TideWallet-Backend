const { v4: uuidv4 } = require('uuid');
const ResponseFormat = require('./ResponseFormat');
const Bot = require('./Bot.js');
const Utils = require('./Utils');
const Codes = require('./Codes');
const HDWallet = require('./HDWallet');

class Account extends Bot {
  constructor() {
    super();
    this.name = 'Account';
    this.tags = {};
  }

  init({
    config, database, logger, i18n,
  }) {
    return super.init({
      config, database, logger, i18n,
    }).then(() => {
      this.userModel = this.database.db.User;
      this.blockchainModel = this.database.db.Blockchain;
      this.tokenSecretModel = this.database.db.TokenSecret;
      this.currencyModel = this.database.db.Currency;
      this.accountModel = this.database.db.Account;
      this.accountCurrencyModel = this.database.db.AccountCurrency;
      this.accountAddressModel = this.database.db.AccountAddress;
      this.addressTransactionModel = this.database.db.AddressTransaction;
      this.transactionModel = this.database.db.Transaction;
      this.addressTokenTransactionModel = this.database.db.AddressTokenTransaction;
      this.tokenTransactionModel = this.database.db.TokenTransaction;
      this.deviceModel = this.database.db.Device;
      this.utxoModel = this.database.db.UTXO;

      this.sequelize = this.database.db.sequelize;
      this.Sequelize = this.database.db.Sequelize;
      return this;
    });
  }

  async TokenRegist({ params, token }) {
    try {
      const { blockchain_id, currency_id } = params;

      if (!Utils.validateString(blockchain_id) || !Utils.validateString(currency_id)) {
        return new ResponseFormat({ message: 'invalid input', code: Codes.INVALID_INPUT });
      }

      if (!token) return new ResponseFormat({ message: 'invalid token', code: Codes.INVALID_ACCESS_TOKEN });
      const tokenInfo = await Utils.verifyToken(token);

      // find Token is exist
      const findTokenItem = await this.currencyModel.findOne({
        where: { type: 2, currency_id },
      });

      if (findTokenItem) {
        // check token x blockchain mapping
        if (findTokenItem.blockchain_id !== blockchain_id) return new ResponseFormat({ message: 'blockchain has not token', code: Codes.BLOCKCHAIN_HAS_NOT_TOKEN });

        // check account token is exist
        const findUserAccountData = await this.accountModel.findOne({
          where: {
            user_id: tokenInfo.userID, blockchain_id,
          },
        });
        if (!findUserAccountData) return new ResponseFormat({ message: 'account not found', code: Codes.ACCOUNT_NOT_FOUND });

        const findUserAccountToken = await this.accountCurrencyModel.findOne({
          where: {
            account_id: findUserAccountData.account_id, currency_id,
          },
        });
        if (findUserAccountToken) return new ResponseFormat({ message: 'account token exist', code: Codes.ACCOUNT_TOKEN_EXIST });

        // create token data to db
        try {
          const token_account_id = uuidv4();
          await this.accountCurrencyModel.create({
            accountCurrency_id: token_account_id,
            account_id: findUserAccountData.account_id,
            currency_id,
            balance: '0',
            number_of_external_key: '0',
            number_of_internal_key: '0',
          });

          return new ResponseFormat({ message: 'Account Token Regist', payload: { token_account_id } });
        } catch (e) {
          return new ResponseFormat({ message: `DB Error(${e.message})`, code: Codes.DB_ERROR });
        }
      }

      // TODO: if not found token in DB, parse token contract info from blockchain
      return new ResponseFormat({ message: 'Account Token Regist', payload: {} });
    } catch (e) {
      this.logger.error('TokenRegist e:', e);
      if (e.code) return e;
      return new ResponseFormat({ message: `DB Error(${e.message})`, code: Codes.DB_ERROR });
    }
  }

  async AccountList({ token }) {
    if (!token) return new ResponseFormat({ message: 'invalid token', code: Codes.INVALID_ACCESS_TOKEN });
    const tokenInfo = await Utils.verifyToken(token);
    const payload = [];

    try {
      const findAccounts = await this.accountModel.findAll({
        where: {
          user_id: tokenInfo.userID,
        },
        include: [
          {
            model: this.blockchainModel,
            attributes: ['network_id'],
          },
        ],
      });

      for (let i = 0; i < findAccounts.length; i++) {
        const account = findAccounts[i];
        const findAccountCurrencies = await this.accountCurrencyModel.findAll({
          where: {
            account_id: account.account_id,
          },
          include: [
            {
              model: this.currencyModel,
              attributes: ['type'],
              where: {
                type: 1,
              },
            },
          ],
        });
        for (let j = 0; j < findAccountCurrencies.length; j++) {
          const accountCurrency = findAccountCurrencies[j];
          payload.push({
            account_id: accountCurrency.accountCurrency_id,
            blockchain_id: account.blockchain_id,
            network_id: account.Blockchain.network_id,
            currency_id: accountCurrency.currency_id,
            balance: accountCurrency.balance,
            account_index: '0',
          });
        }
      }
      return new ResponseFormat({ message: 'Get Account List', payload });
    } catch (e) {
      this.logger.error('AccountList e:', e);
      if (e.code) return e;
      return new ResponseFormat({ message: `DB Error(${e.message})`, code: Codes.DB_ERROR });
    }
  }

  async AccountDetail({ token, params }) {
    if (!token) return new ResponseFormat({ message: 'invalid token', code: Codes.INVALID_ACCESS_TOKEN });
    const tokenInfo = await Utils.verifyToken(token);

    // account_id -> accountCurrency_id
    const { account_id } = params;
    if (!Utils.validateString(account_id)) return new ResponseFormat({ message: 'invalid input', code: Codes.INVALID_INPUT });
    const payload = {};
    const tokens = [];

    try {
      // check user has this account currency & accountCurrency_id exist
      const findAccountCurrency = await this.accountCurrencyModel.findOne({
        where: {
          accountCurrency_id: account_id,
        },
        include: [
          {
            model: this.accountModel,
            where: {
              user_id: tokenInfo.userID,
            },
          },
        ],
      });
      if (!findAccountCurrency) return new ResponseFormat({ message: 'account not found', code: Codes.ACCOUNT_NOT_FOUND });

      const findAccount = findAccountCurrency.Account;

      // find account currencies info
      const findAccountCurrencies = await this.accountCurrencyModel.findAll({
        where: {
          account_id: findAccount.account_id,
        },
        include: [
          {
            model: this.currencyModel,
            attributes: ['currency_id', 'name', 'symbol', 'type', 'publish', 'decimals', 'total_supply', 'contract', 'icon'],
            where: {
              [this.Sequelize.Op.or]: [{ type: 1 }, { type: 2 }],
            },
          },
        ],
      });
      for (let j = 0; j < findAccountCurrencies.length; j++) {
        const accountCurrency = findAccountCurrencies[j];
        if (accountCurrency.Currency && accountCurrency.Currency.type === 1) {
          payload.blockchain_id = findAccount.blockchain_id;
          payload.currency_id = accountCurrency.currency_id;
          payload.account_id = accountCurrency.accountCurrency_id;
          payload.purpose = findAccount.purpose;
          payload.account_index = '0';
          payload.curve_type = findAccount.curve_type;
          payload.number_of_external_key = findAccount.number_of_external_key;
          payload.number_of_internal_key = findAccount.number_of_internal_key;
          payload.balance = accountCurrency.balance;
          payload.symbol = accountCurrency.Currency.symbol;
          payload.icon = accountCurrency.Currency.icon;
        } else if (accountCurrency.Currency && accountCurrency.Currency.type === 2) {
          tokens.push({
            account_token_id: accountCurrency.accountCurrency_id,
            token_id: accountCurrency.Currency.currency_id,
            blockchain_id: findAccount.blockchain_id,
            name: accountCurrency.Currency.name,
            symbol: accountCurrency.Currency.symbol,
            type: accountCurrency.Currency.type,
            publish: accountCurrency.Currency.publish,
            decimals: accountCurrency.Currency.decimals,
            total_supply: accountCurrency.Currency.total_supply,
            contract: accountCurrency.Currency.contract,
            balance: accountCurrency.balance,
          });
        }
      }
      payload.tokens = tokens;
      return new ResponseFormat({ message: 'Get Account List', payload });
    } catch (e) {
      this.logger.error('AccountDetail e:', e);
      if (e.code) return e;
      return new ResponseFormat({ message: `DB Error(${e.message})`, code: Codes.DB_ERROR });
    }
  }

  async AccountReceive({ params, token }) {
    // account_id -> accountCurrency_id
    const { account_id } = params;
    if (!Utils.validateString(account_id)) return new ResponseFormat({ message: 'invalid input', code: Codes.INVALID_INPUT });

    if (!token) return new ResponseFormat({ message: 'invalid token', code: Codes.INVALID_ACCESS_TOKEN });
    const tokenInfo = await Utils.verifyToken(token);

    try {
      const findAccountCurrency = await this.accountCurrencyModel.findOne({
        where: { accountCurrency_id: account_id },
        include: [
          {
            model: this.accountModel,
            attributes: ['account_id', 'user_id', 'extend_public_key'],
            where: {
              user_id: tokenInfo.userID,
            },
            include: [
              {
                model: this.blockchainModel,
                attributes: ['blockchain_id', 'block', 'coin_type'],
              },
            ],
          },
        ],
      });
      if (!findAccountCurrency) return new ResponseFormat({ message: 'account not found', code: Codes.ACCOUNT_NOT_FOUND });

      const findReceiveAddress = await this.accountAddressModel.findOne({
        where: {
          account_id: findAccountCurrency.Account.account_id,
          chain_index: 0,
          key_index: findAccountCurrency.number_of_external_key,
        },
      });

      const hdWallet = new HDWallet({ extendPublicKey: findAccountCurrency.Account.extend_public_key });
      // if index address not found
      let { address } = findReceiveAddress || {};
      if (!findReceiveAddress) {
        const coinType = findAccountCurrency.Account.Blockchain.coin_type;
        const wallet = hdWallet.getWalletInfo({
          change: 0,
          index: findAccountCurrency.number_of_external_key,
          coinType,
          blockchainID: findAccountCurrency.Account.Blockchain.Blockchain_id,
        });

        await this.accountAddressModel.create({
          accountAddress_id: uuidv4(),
          account_id: findAccountCurrency.Account.account_id,
          chain_index: 0,
          key_index: 0,
          public_key: wallet.publicKey,
          address: wallet.address,
        });

        address = wallet.address;
      }

      return new ResponseFormat({
        message: 'Get Receive Address',
        payload: {
          address,
          key_index: findAccountCurrency.number_of_external_key,
        },
      });
    } catch (e) {
      this.logger.error('AccountReceive e:', e);
      if (e.code) return e;
      return new ResponseFormat({ message: `DB Error(${e.message})`, code: Codes.DB_ERROR });
    }
  }

  async AccountChange({ params, token }) {
    // account_id -> accountCurrency_id
    const { account_id } = params;
    if (!Utils.validateString(account_id)) return new ResponseFormat({ message: 'invalid input', code: Codes.INVALID_INPUT });

    if (!token) return new ResponseFormat({ message: 'invalid token', code: Codes.INVALID_ACCESS_TOKEN });
    const tokenInfo = await Utils.verifyToken(token);

    try {
      const findAccountCurrency = await this.accountCurrencyModel.findOne({
        where: { accountCurrency_id: account_id },
        include: [
          {
            model: this.accountModel,
            attributes: ['account_id', 'user_id', 'extend_public_key'],
            where: {
              user_id: tokenInfo.userID,
            },
            include: [
              {
                model: this.blockchainModel,
                attributes: ['blockchain_id', 'block', 'coin_type'],
              },
            ],
          },
        ],
      });
      if (!findAccountCurrency) return new ResponseFormat({ message: 'account not found', code: Codes.ACCOUNT_NOT_FOUND });

      const findChangeAddress = await this.accountAddressModel.findOne({
        where: {
          account_id: findAccountCurrency.Account.account_id,
          chain_index: 1,
          key_index: findAccountCurrency.number_of_internal_key,
        },
      });

      const hdWallet = new HDWallet({ extendPublicKey: findAccountCurrency.Account.extend_public_key });
      // if index address not found
      let { address } = findChangeAddress || {};
      if (!findChangeAddress) {
        const coinType = findAccountCurrency.Account.Blockchain.coin_type;
        const wallet = hdWallet.getWalletInfo({
          change: 1,
          index: findAccountCurrency.number_of_internal_key,
          coinType,
          blockchainID: findAccountCurrency.Account.Blockchain.blockchain_id,
        });

        await this.accountAddressModel.create({
          accountAddress_id: uuidv4(),
          account_id: findAccountCurrency.Account.account_id,
          chain_index: 1,
          key_index: 0,
          public_key: wallet.publicKey,
          address: wallet.address,
        });

        address = wallet.address;
      }

      return new ResponseFormat({
        message: 'Get Change Address',
        payload: {
          address,
          key_index: findAccountCurrency.number_of_internal_key,
        },
      });
    } catch (e) {
      this.logger.error('AccountChange e:', e);
      if (e.code) return e;
      return new ResponseFormat({ message: `DB Error(${e.message})`, code: Codes.DB_ERROR });
    }
  }

  async _findAccountTXs({
    findAccountCurrency, txs, chain_index, key_index,
  }) {
    const isToken = findAccountCurrency.Currency.type === 2;
    const findAccountAddress = await this.accountAddressModel.findOne({
      where: { account_id: findAccountCurrency.account_id, chain_index, key_index },
    });
    // find all tx by address
    if (findAccountAddress) {
      if (isToken) {
        const findTxByAddress = await this.addressTokenTransactionModel.findAll({
          where: {
            currency_id: findAccountCurrency.currency_id,
            accountAddress_id: findAccountAddress.accountAddress_id,
          },
          include: [
            {
              model: this.tokenTransactionModel,
              include: [
                {
                  model: this.transactionModel,
                },
              ],
            },
          ],
        });
        if (findTxByAddress && findTxByAddress.length > 0) {
          for (let j = 0; j < findTxByAddress.length; j++) {
            const txInfo = findTxByAddress[j];
            txs.push({
              txid: txInfo.TokenTransaction.Transaction.txid,
              status: (isToken) ? findTxByAddress.result : 'success',
              amount: txInfo.TokenTransaction.amount,
              symbol: findAccountCurrency.Currency.symbol, // "unit"
              direction: txInfo.TokenTransaction.direction === 0 ? 'send' : 'receive',
              confirmations: findAccountCurrency.Account.Blockchain.block - txInfo.TokenTransaction.Transaction.block,
              timestamp: txInfo.TokenTransaction.timestamp,
              source_addresses: txInfo.TokenTransaction.source_addresses,
              destination_addresses: txInfo.TokenTransaction.destination_addresses,
              fee: txInfo.TokenTransaction.Transaction.fee,
            });
          }
        }
      } else {
        const findTxByAddress = await this.addressTransactionModel.findAll({
          where: {
            currency_id: findAccountCurrency.currency_id,
            accountAddress_id: findAccountAddress.accountAddress_id,
          },
          include: [
            {
              model: this.transactionModel,
            },
          ],
        });
        if (findTxByAddress) {
          for (let j = 0; j < findTxByAddress.length; j++) {
            const txInfo = findTxByAddress[j];
            txs.push({
              txid: txInfo.Transaction.txid,
              // eslint-disable-next-line no-nested-ternary
              status: (isToken) ? findTxByAddress.result ? 'success' : 'failed' : 'success',
              amount: txInfo.Transaction.amount,
              symbol: findAccountCurrency.Currency.symbol, // "unit"
              direction: txInfo.direction === 0 ? 'send' : 'receive',
              confirmations: findAccountCurrency.Account.Blockchain.block - txInfo.Transaction.block,
              timestamp: txInfo.Transaction.timestamp,
              source_addresses: txInfo.Transaction.source_addresses,
              destination_addresses: txInfo.Transaction.destination_addresses,
              fee: txInfo.Transaction.fee,
            });
          }
        }
      }
    }
  }

  async ListTransactions({ params, token }) {
    // account_id -> accountCurrency_id
    const { account_id } = params;

    if (!token) return new ResponseFormat({ message: 'invalid token', code: Codes.INVALID_ACCESS_TOKEN });
    const tokenInfo = await Utils.verifyToken(token);
    try {
      const findAccountCurrency = await this.accountCurrencyModel.findOne({
        where: { accountCurrency_id: account_id },
        include: [
          {
            model: this.accountModel,
            attributes: ['account_id', 'user_id'],
            where: {
              user_id: tokenInfo.userID,
            },
            include: [
              {
                model: this.blockchainModel,
                attributes: ['blockchain_id', 'block', 'coin_type'],
              },
            ],
          },
          {
            model: this.currencyModel,
            attributes: ['type', 'symbol'],
          },
        ],
      });

      if (!findAccountCurrency) return new ResponseFormat({ message: 'account not found', code: Codes.ACCOUNT_NOT_FOUND });

      const { number_of_external_key, number_of_internal_key } = findAccountCurrency;
      const payload = [];
      // find external address txs
      for (let i = 0; i <= number_of_external_key; i++) {
        // find all address
        await this._findAccountTXs({
          findAccountCurrency, txs: payload, chain_index: 0, key_index: i,
        });
      }

      // find internal address txs
      for (let i = 0; i <= number_of_internal_key; i++) {
        await this._findAccountTXs({
          findAccountCurrency, txs: payload, chain_index: 1, key_index: i,
        });
      }

      // sort by timestamps
      payload.sort((a, b) => b.timestamp - a.timestamp);

      return new ResponseFormat({
        message: 'List Transactions',
        payload,
      });
    } catch (e) {
      this.logger.error('ListTransactions e:', e);
      if (e.code) return e;
      return new ResponseFormat({ message: `DB Error(${e.message})`, code: Codes.DB_ERROR });
    }
  }

  async TransactionDetail({ params }) {
    const { txid } = params;

    try {
    // find Transaction table
      const findTX = await this.transactionModel.findOne({
        where: { txid },
        include: [
          {
            model: this.currencyModel,
            attributes: ['currency_id', 'symbol'],
            include: [
              {
                model: this.blockchainModel,
                attributes: ['blockchain_id', 'block'],
              },
            ],
          },
        ],
      });
      if (findTX) {
        return new ResponseFormat({
          message: 'Get Transaction Detail',
          payload: {
            txid: findTX.txid,
            status: findTX.result ? 'success' : 'failed',
            confirmations: findTX.Currency.Blockchain.block - findTX.block,
            amount: findTX.amount,
            blockchain_id: findTX.Currency.Blockchain.blockchain_id,
            symbol: findTX.Currency.symbol,
            direction: findTX.direction === 0 ? 'send' : 'receive',
            timestamp: findTX.timestamp,
            source_addresses: findTX.source_addresses,
            destination_addresses: findTX.destination_addresses,
            fee: findTX.fee,
          },
        });
      }
      return new ResponseFormat({ message: 'txid not found', code: Codes.TX_NOT_FOUND });
    } catch (e) {
      this.logger.error('TransactionDetail e:', e);
      if (e.code) return e;
      return new ResponseFormat({ message: `DB Error(${e.message})`, code: Codes.DB_ERROR });
    }
  }

  _formateUTXOType(typeValue) {
    switch (typeValue) {
      case 0:
        return 'legacy';
      case 1:
        return 'segwit';
      case 2:
        return 'native_segwit';
      default:
        return 'legacy';
    }
  }

  async _findAccountUTXO({
    findAccountCurrency, payload, chain_index, key_index,
  }) {
    // find AccountAddress
    const findAccountAddress = await this.accountAddressModel.findOne({ where: { account_id: findAccountCurrency.Account.account_id, chain_index, key_index } });
    if (!findAccountAddress) return new ResponseFormat({ message: 'account not found(address not found)', code: Codes.ACCOUNT_NOT_FOUND });

    // find all UTXO
    const findUTXO = await this.utxoModel.findAll({
      where: { accountAddress_id: findAccountAddress.accountAddress_id },
    });

    for (let i = 0; i < findUTXO.length; i++) {
      const utxo = findUTXO[i];
      payload.push({
        txid: utxo.txid,
        utxo_id: utxo.utxo_id,
        vout: utxo.vout,
        'type:': this._formateUTXOType(utxo.type),
        amount: utxo.amount,
        script: utxo.script,
        timestamp: utxo.on_block_timestamp,
        chain_index,
        key_index,
      });
    }
  }

  async GetUTXO({ params, token }) {
    // account_id -> accountCurrency_id
    const { account_id } = params;

    if (!token) return new ResponseFormat({ message: 'invalid token', code: Codes.INVALID_ACCESS_TOKEN });
    const tokenInfo = await Utils.verifyToken(token);

    try {
      // find Account
      const findAccountCurrency = await this.accountCurrencyModel.findOne({
        where: {
          accountCurrency_id: account_id,
        },
        include: [
          {
            model: this.accountModel,
            where: {
              user_id: tokenInfo.userID,
            },
          },
        ],
      });
      if (!findAccountCurrency) return new ResponseFormat({ message: 'account not found', code: Codes.ACCOUNT_NOT_FOUND });

      const { number_of_external_key, number_of_internal_key } = findAccountCurrency;
      const payload = [];
      // find external address txs
      for (let i = 0; i <= number_of_external_key; i++) {
        // find all address
        await this._findAccountUTXO({
          findAccountCurrency, payload, chain_index: 0, key_index: i,
        });
      }

      // find internal address txs
      for (let i = 0; i <= number_of_internal_key; i++) {
        await this._findAccountUTXO({
          findAccountCurrency, payload, chain_index: 1, key_index: i,
        });
      }

      // sort by timestamps
      payload.sort((a, b) => b.timestamp - a.timestamp);

      return new ResponseFormat({
        message: 'List Transactions',
        payload,
      });
    } catch (e) {
      this.logger.error('GetUTXO e:', e);
      if (e.code) return e;
      return new ResponseFormat({ message: `DB Error(${e.message})`, code: Codes.DB_ERROR });
    }
  }

  async DROP_ALL_TABLE() {
    await this.sequelize.drop();
  }
}

module.exports = Account;