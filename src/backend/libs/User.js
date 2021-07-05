const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { default: BigNumber } = require('bignumber.js');
const HDWallet = require('./HDWallet');
const ResponseFormat = require('./ResponseFormat');
const Bot = require('./Bot.js');
const Utils = require('./Utils');
const Codes = require('./Codes');
const DBOperator = require('./DBOperator');
const blockchainNetworks = require('./data/blockchainNetworks');
const Fcm = require('./Fcm');

class User extends Bot {
  constructor() {
    super();
    this.name = 'User';
    this.tags = {};
  }

  init({
    config, database, logger, i18n,
  }) {
    return super.init({
      config, database, logger, i18n,
    }).then(() => {
      this.DBOperator = new DBOperator(this.config, this.database, this.logger);
      this.defaultDBInstance = this.database.db[Utils.defaultDBInstanceName];

      this.sequelize = this.defaultDBInstance.sequelize;
      this.Sequelize = this.defaultDBInstance.Sequelize;
      return this;
    }).then(() => {
      this.fcm = Fcm.getInstance({ logger: this.logger });
      console.log('\x1b[1m\x1b[32mFCM  \x1b[0m\x1b[21m init success');
      return this;
    });
  }

  async UserAppID({ body, retry = 3 }) {
    const { id } = body;
    const t1 = Date.now();

    const findUserApp = await this.defaultDBInstance.UserApp.findOne({
      where: { app_id: id },
    });
    if (findUserApp) {
      const t2 = Date.now();
      this.logger.log(`UserAppID: ${(t2 - t1) / 1000} sec`);
      return new ResponseFormat({
        message: 'User App ID',
        payload: {
          user_id: findUserApp.app_user_id,
          user_secret: findUserApp.app_user_secret,
        },
      });
    }

    const app_user_id = crypto.randomBytes(12).toString('hex');
    const app_user_secret = crypto.randomBytes(12).toString('hex');
    try {
      await this.defaultDBInstance.UserApp.create({
        app_id: id,
        app_user_id,
        app_user_secret,
      });
    } catch (e) {
      if (retry <= 0) return new ResponseFormat({ message: 'invalid input', code: Codes.INVALID_INPUT });
      setTimeout(() => {
        this.UserAppID({ body, retry: retry -= 1 });
      }, 300);
    }

    const t2 = Date.now();
    this.logger.log(`UserAppID: ${(t2 - t1) / 1000} sec`);
    return new ResponseFormat({
      message: 'User App ID',
      payload: {
        user_id: app_user_id,
        user_secret: app_user_secret,
      },
    });
  }

  async UserRegist({ body }) {
    const {
      wallet_name, extend_public_key, install_id, app_uuid, fcm_token,
    } = body;

    if (!Utils.validateString(wallet_name)
    || !Utils.validateString(extend_public_key)
    || !Utils.validateString(install_id)
    || !Utils.validateString(app_uuid)) {
      return new ResponseFormat({ message: 'invalid input', code: Codes.INVALID_INPUT });
    }

    try {
      const findUser = await this.defaultDBInstance.Account.findOne({ where: { extend_public_key } });

      // recover
      if (findUser) {
        // if new app_id, add it
        await this.defaultDBInstance.Device.findOrCreate({
          where: {
            install_id, app_uuid,
          },
          defaults: {
            device_id: uuidv4(),
            user_id: findUser.user_id,
            install_id,
            timestamp: Math.floor(Date.now() / 1000),
            name: '',
            app_uuid,
          },
        });

        if (fcm_token) await this.fcm.registAccountFCMToken(findUser.user_id, fcm_token);

        const payload = await Utils.generateToken({ userID: findUser.user_id });
        return new ResponseFormat({ message: 'User Regist', payload });
      }

      // new user
      const insertUser = await this.defaultDBInstance.User.create({
        user_id: uuidv4(),
        wallet_name,
        last_login_timestamp: Math.floor(Date.now() / 1000),
      });

      const hdWallet = new HDWallet({ extendPublicKey: extend_public_key });

      const accounts = await this.DBOperator.findAll({
        tableName: 'Currency',
        options: {
          where: { type: 1 },
          include: [
            {
              _model: 'Blockchain',
              attributes: ['blockchain_id', 'block', 'coin_type'],
            },
          ],
        },
      });

      for (let i = 0; i < accounts.length; i++) {
        const DBName = Utils.blockchainIDToDBName(accounts[i].blockchain_id);
        const _db = this.database.db[DBName];

        const insertAccount = await _db.Account.create({
          account_id: uuidv4(),
          user_id: insertUser.user_id,
          blockchain_id: accounts[i].blockchain_id,
          purpose: 3324,
          curve_type: 0,
          extend_public_key,
          regist_block_num: accounts[i].Blockchain.block,
        });

        await _db.AccountCurrency.create({
          accountCurrency_id: uuidv4(),
          account_id: insertAccount.account_id,
          currency_id: accounts[i].currency_id,
          balance: '0',
          number_of_external_key: '0',
          number_of_internal_key: '0',
        });

        const coinType = accounts[i].Blockchain.coin_type;
        const wallet = hdWallet.getWalletInfo({ coinType, blockchainID: accounts[i].Blockchain.blockchain_id });

        await _db.AccountAddress.create({
          accountAddress_id: uuidv4(),
          account_id: insertAccount.account_id,
          chain_index: 0,
          key_index: 0,
          public_key: wallet.publicKey,
          address: wallet.address,
        });

        if (accounts[i].blockchain_id === '80000000' || accounts[i].blockchain_id === 'F0000000' || accounts[i].blockchain_id === '80000091' || accounts[i].blockchain_id === 'F0000091') {
          const changeWallet = hdWallet.getWalletInfo({ coinType, blockchainID: accounts[i].Blockchain.blockchain_id, change: 1 });
          await _db.AccountAddress.create({
            accountAddress_id: uuidv4(),
            account_id: insertAccount.account_id,
            chain_index: 1,
            key_index: 0,
            public_key: changeWallet.publicKey,
            address: changeWallet.address,
          });
        }
      }
      await this.defaultDBInstance.Device.create({
        device_id: uuidv4(),
        user_id: insertUser.user_id,
        install_id,
        timestamp: Math.floor(Date.now() / 1000),
        name: '',
        app_uuid,
      });

      if (fcm_token) await this.fcm.registAccountFCMToken(insertUser.user_id, fcm_token);

      const payload = await Utils.generateToken({ userID: insertUser.user_id });
      return new ResponseFormat({ message: 'User Regist', payload });
    } catch (e) {
      this.logger.error('UserRegist e:', e);
      if (e.code) return e;
      return new ResponseFormat({ message: `DB Error(${e.message})`, code: Codes.DB_ERROR });
    }
  }

  async AccessTokenVerify({ query }) {
    const { token } = query;
    if (!token) return new ResponseFormat({ message: 'invalid input', code: Codes.INVALID_INPUT });

    try {
      const data = await Utils.verifyToken(token);

      return new ResponseFormat({
        message: 'Token Verify',
        payload: {
          user_id: data.userID,
          wallet_name: data.user.wallet_name,
        },
      });
    } catch (e) {
      this.logger.error('AccessTokenVerify e:', e);
      if (e.code) return e;
      return e;
    }
  }

  async AccessTokenRenew({ body }) {
    const { token, tokenSecret } = body;
    if (!Utils.validateString(token) || !Utils.validateString(tokenSecret)) {
      return new ResponseFormat({ message: 'invalid input', code: Codes.INVALID_INPUT });
    }
    try {
      const t1 = Date.now();
      const data = await Utils.verifyToken(token, true);
      const findTokenSecret = await this.defaultDBInstance.TokenSecret.findOne({
        where: {
          tokenSecret, user_id: data.userID,
        },
      });

      if (!findTokenSecret) return new ResponseFormat({ message: 'invalid access token secret', code: Codes.INVALID_ACCESS_TOKEN_SECRET });
      if (new Date() > (findTokenSecret.expire_time)) return new ResponseFormat({ message: 'expired access token secret', code: Codes.EXPIRED_ACCESS_TOKEN_SECRET });

      const payload = await this.sequelize.transaction(async (transaction) => {
        const tokenObj = await Utils.generateToken({ userID: data.userID });

        // if generateToken success, delete old tokenSecret
        await this.defaultDBInstance.TokenSecret.destroy({
          where: {
            tokenSecret: findTokenSecret.tokenSecret, user_id: findTokenSecret.user_id,
          },
        }, { transaction });

        return tokenObj;
      });
      const t2 = Date.now();
      this.logger.log(`AccessTokenRenew: ${(t2 - t1) / 1000} sec`);
      return new ResponseFormat({ message: 'Token Renew', payload });
    } catch (e) {
      this.logger.error('AccessTokenRenew e:', e);
      if (e.code) return e;
      throw e;
    }
  }

  async test({ token, body }) {
    try {
      const tmp = await this.database.db.ethereum_ropsten.BlockScanned.findOne({
        where: { block: new BigNumber('0x9864e9').toString() },
      });
      return tmp;

      const {
        txid, accountId, currencyId, blockchainId,
      } = body;
      if (!token) return new ResponseFormat({ message: 'invalid token', code: Codes.INVALID_ACCESS_TOKEN });
      const tokenInfo = await Utils.verifyToken(token);

      const DBName = Utils.blockchainIDToDBName(blockchainId);
      const _db = this.database.db[DBName];

      const findBlockInfo = await _db.Blockchain.findOne({
        where: { blockchain_id: blockchainId },
      });

      const findAccountCurrency = await _db.AccountCurrency.findOne({
        where: {
          accountCurrency_id: accountId,
        },
        attributes: ['account_id', 'accountCurrency_id'],
      });
      const findAccountAddress = await _db.AccountAddress.findOne({
        where: {
          account_id: findAccountCurrency.account_id,
        },
        attributes: ['accountAddress_id'],
      });

      const findTx = await _db.AddressTransaction.findOne({
        where: {
          accountAddress_id: findAccountAddress.accountAddress_id,
          currency_id: currencyId,
        },
        include: [
          {
            model: _db.Transaction,
          },
        ],
      });
      console.log('before findAccountCurrency!!!');

      await this.fcm.messageToUserTopic(tokenInfo.userID, {
        title: `tx (${tx.txid}) is confirmations`,
      }, {
        title: `tx (${tx.txid}) is confirmations`,
        body: JSON.stringify({
          blockchainId,
          accountId: findAccountCurrency.accountCurrency_id,
          eventType: 'TRANSACTION_CONFIRM',
          currencyId,
          data: {
            txid,
            status: findTx.Transaction.result ? 'success' : 'failed',
            amount: findTx.Transaction.amount,
            symbol: DBName,
            direction: findTx.direction === 0 ? 'send' : 'receive',
            confirmations: findBlockInfo.block - findTx.Transaction.block,
            timestamp: findTx.Transaction.timestamp,
            source_addresses: findTx.Transaction.source_addresses,
            destination_addresses: findTx.Transaction.destination_addresses,
            fee: findTx.Transaction.fee,
            gas_price: findTx.Transaction.gas_price,
            gas_used: findTx.Transaction.gas_used,
            note: findTx.Transaction.note,
            balance: 0,
          },
        }),
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
      });
      return true;
    } catch (e) {
      console.log(e);
      return e;
    }
  }
}

module.exports = User;
