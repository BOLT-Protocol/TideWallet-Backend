const { v4: uuidv4 } = require('uuid');
const BigNumber = require('bignumber.js');
const ecrequest = require('ecrequest');
const ResponseFormat = require('./ResponseFormat');
const Bot = require('./Bot.js');
const Utils = require('./Utils');
const DBOperator = require('./DBOperator');
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
      this.DBOperator = new DBOperator(this.config, this.database, this.logger);
      this.defaultDBInstance = this.database.db[Utils.defaultDBInstanceName];

      this.sequelize = this.defaultDBInstance.sequelize;
      this.Sequelize = this.defaultDBInstance.Sequelize;
      return this;
    });
  }

  async TokenRegist({ params, token }) {
    try {
      const { blockchain_id, contract = '' } = params;
      if (!Utils.validateString(contract)) {
        return new ResponseFormat({ message: 'invalid input', code: Codes.INVALID_INPUT });
      }

      if (!token) return new ResponseFormat({ message: 'invalid token', code: Codes.INVALID_ACCESS_TOKEN });
      const tokenInfo = await Utils.verifyToken(token);

      const DBName = Utils.blockchainIDToDBName(blockchain_id);
      const _db = this.database.db[DBName];

      // find Token is exist
      let findTokenItem = await _db.Currency.findOne({
        where: {
          type: 2, contract,
        },
      });

      if (!findTokenItem) {
        // if not found token in DB, parse token contract info from blockchain

        let options = '';
        switch (blockchain_id) {
          case '8000003C':
            options = this.config.blockchain.ethereum_mainnet;
            break;
          case 'F000003C':
            options = this.config.blockchain.ethereum_ropsten;
            break;
          case '80000CFC':
            options = this.config.blockchain.cafeca;
            break;
          default:
            return new ResponseFormat({ message: 'blockchain has not token', code: Codes.BLOCKCHAIN_HAS_NOT_TOKEN });
        }

        const tokenInfoFromPeer = await Promise.all([
          Utils.getTokenNameFromPeer(options, contract),
          Utils.getTokenSymbolFromPeer(options, contract),
          Utils.getTokenDecimalFromPeer(options, contract),
          Utils.getTokenTotalSupplyFromPeer(options, contract),
        ]).catch((error) => new ResponseFormat({ message: `rpc error(${error})`, code: Codes.RPC_ERROR }));
        if (tokenInfoFromPeer.code === Codes.RPC_ERROR) return tokenInfoFromPeer;

        let icon = `https://cdn.jsdelivr.net/gh/atomiclabs/cryptocurrency-icons@9ab8d6934b83a4aa8ae5e8711609a70ca0ab1b2b/32/icon/${tokenInfoFromPeer[1].toLocaleLowerCase()}.png`;
        try {
          const checkIcon = await ecrequest.get({
            protocol: 'https:',
            hostname: 'cdn.jsdelivr.net',
            port: '',
            path: `/gh/atomiclabs/cryptocurrency-icons@9ab8d6934b83a4aa8ae5e8711609a70ca0ab1b2b/32/icon/${tokenInfoFromPeer[1].toLocaleLowerCase()}.png`,
            timeout: 1000,
          });
          if (checkIcon.data.toString().indexOf('Couldn\'t find') !== -1) throw Error('Couldn\'t find');
        } catch (e) {
          icon = `${this.config.base.domain}/icon/ERC20.png`;
        }

        let total_supply = tokenInfoFromPeer[3];
        try {
          total_supply = new BigNumber(tokenInfoFromPeer[3]).dividedBy(new BigNumber(10 ** tokenInfoFromPeer[2])).toFixed({
            groupSeparator: ',', groupSize: 3,
          });
          // eslint-disable-next-line no-empty
        } catch (e) {
        }

        const newCurrencyID = uuidv4();
        if (!Array.isArray(tokenInfoFromPeer) || !tokenInfoFromPeer[0] || !tokenInfoFromPeer[1] || !(tokenInfoFromPeer[2] >= 0) || !tokenInfoFromPeer[3]) return new ResponseFormat({ message: 'contract not found', code: Codes.CONTRACT_CONT_FOUND });
        findTokenItem = await _db.Currency.create({
          currency_id: newCurrencyID,
          blockchain_id,
          name: tokenInfoFromPeer[0],
          symbol: tokenInfoFromPeer[1],
          type: 2,
          publish: false,
          decimals: tokenInfoFromPeer[2],
          total_supply,
          contract,
          icon,
        });
      }
      // check account token is exist
      const findUserAccountData = await _db.Account.findOne({
        where: {
          user_id: tokenInfo.userID, blockchain_id,
        },
      });
      if (!findUserAccountData) return new ResponseFormat({ message: 'account not found', code: Codes.ACCOUNT_NOT_FOUND });

      const { currency_id } = findTokenItem;
      const findUserAccountToken = await _db.AccountCurrency.findOne({
        where: {
          account_id: findUserAccountData.account_id, currency_id,
        },
      });
      if (findUserAccountToken) return new ResponseFormat({ message: 'account token exist', code: Codes.ACCOUNT_TOKEN_EXIST });
      // create token data to db
      try {
        const token_account_id = uuidv4();
        await _db.AccountCurrency.create({
          accountCurrency_id: token_account_id,
          account_id: findUserAccountData.account_id,
          currency_id: findTokenItem.currency_id,
          balance: '0',
          number_of_external_key: '0',
          number_of_internal_key: '0',
        });

        return new ResponseFormat({ message: 'Account Token Regist', payload: { token_id: currency_id } });
      } catch (e) {
        return new ResponseFormat({ message: `DB Error(${e.message})`, code: Codes.DB_ERROR });
      }
    } catch (e) {
      this.logger.error('TokenRegist e:', e);
      if (e.code) return e;
      return new ResponseFormat({ message: `DB Error(${e.message})`, code: Codes.DB_ERROR });
    }
  }

  async AccountList({ token }) {
    const t1 = Date.now();
    if (!token) return new ResponseFormat({ message: 'invalid token', code: Codes.INVALID_ACCESS_TOKEN });
    const tokenInfo = await Utils.verifyToken(token);
    const payload = [];

    try {
      const findAccounts = await this.DBOperator.findAll({
        tableName: 'Account',
        options: {
          where: {
            user_id: tokenInfo.userID,
          },
        },
      });

      for (let i = 0; i < findAccounts.length; i++) {
        const DBName = Utils.blockchainIDToDBName(findAccounts[i].blockchain_id);
        const _db = this.database.db[DBName];
        const account = findAccounts[i];
        const findAccountCurrencies = await _db.AccountCurrency.findAll({
          where: {
            account_id: account.account_id,
          },
        });
        for (let j = 0; j < findAccountCurrencies.length; j++) {
          const accountCurrency = findAccountCurrencies[j];
          let { balance } = accountCurrency;
          const { currency_id, accountCurrency_id } = accountCurrency;
          // find network_id
          const network_id = Utils.blockchainIDToNetworkID(account.blockchain_id);

          // find Currency publish
          const findCurrency = await this.DBOperator.findOne({
            tableName: 'Currency',
            options: {
              where: {
                type: 1, currency_id: accountCurrency.currency_id,
              },
            },
          });
          if (findCurrency) {
            const { publish = false, decimals } = findCurrency;
            if (account.blockchain_id === 'F000003C' || account.blockchain_id === '8000003C' || account.blockchain_id === '80000CFC' || account.blockchain_id === '80001F51') {
            // if ETH symbol && balance_sync_block < findBlockHeight, request RPC get balance
              const findBlockHeight = await _db.Blockchain.findOne({ where: { blockchain_id: account.blockchain_id } });
              if (Number(accountCurrency.balance_sync_block) < Number(findBlockHeight.block)) {
                const findAddress = await _db.AccountAddress.findOne({
                  where: { account_id: account.account_id },
                  attributes: ['address'],
                });
                if (findAddress) {
                  balance = await Utils.ethGetBalanceByAddress(account.blockchain_id, findAddress.address, decimals);

                  await _db.AccountCurrency.update(
                    { balance, balance_sync_block: findBlockHeight.block },
                    { where: { accountCurrency_id: accountCurrency.accountCurrency_id } },
                  );
                }
              } else {
                balance = accountCurrency.balance;
              }
            } else {
              const findAllAddress = await _db.AccountAddress.findAll({
                where: { account_id: account.account_id },
                attributes: ['accountAddress_id'],
              });
              balance = new BigNumber(0);
              for (const addressItem of findAllAddress) {
                const findUTXOByAddress = await _db.UTXO.findAll({
                  where: { accountAddress_id: addressItem.accountAddress_id, to_tx: { [this.Sequelize.Op.is]: null } },
                  attributes: ['amount'],
                });

                for (const utxoItem of findUTXOByAddress) {
                  balance = balance.plus(new BigNumber(utxoItem.amount));
                }
              }
              balance = Utils.dividedByDecimal(balance, decimals);
            }

            payload.push({
              account_id: accountCurrency_id,
              blockchain_id: account.blockchain_id,
              network_id,
              currency_id,
              balance,
              publish,
              account_index: '0',
            });
          }
        }
      }

      const t2 = Date.now();
      this.logger.log(`AccountList: ${(t2 - t1) / 1000} sec`);
      return new ResponseFormat({ message: 'Get Account List', payload });
    } catch (e) {
      console.log(e); // -- no console.log
      this.logger.error('AccountList e:', JSON.stringify(e));
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
      const findAccountCurrency = await this.DBOperator.findOne({
        tableName: 'AccountCurrency',
        options: {
          where: {
            accountCurrency_id: account_id,
          },
          include: [
            {
              _model: 'Account',
              where: {
                user_id: tokenInfo.userID,
              },
            },
          ],
        },
      });
      if (!findAccountCurrency) return new ResponseFormat({ message: 'account not found', code: Codes.ACCOUNT_NOT_FOUND });

      const findAccount = findAccountCurrency.Account;
      const DBName = Utils.blockchainIDToDBName(findAccount.blockchain_id);
      const _db = this.database.db[DBName];

      const findAccountCurrencies = await _db.AccountCurrency.findAll({
        where: {
          account_id: findAccountCurrency.account_id,
        },
        include: [
          {
            model: _db.Account,
            where: {
              user_id: tokenInfo.userID,
            },
          },
        ],
      });
      for (let j = 0; j < findAccountCurrencies.length; j++) {
        const accountCurrency = findAccountCurrencies[j];
        // TODO: for sql
        const findCurrency = await _db.Currency.findOne({
          where: {
            currency_id: accountCurrency.currency_id,
            [this.Sequelize.Op.or]: [{ type: 1 }, { type: 2 }],
          },
        });
        if (findCurrency) {
          let { balance = '0' } = accountCurrency;
          if (findAccount.blockchain_id === 'F000003C' || findAccount.blockchain_id === '8000003C' || findAccount.blockchain_id === '80000CFC' || findAccount.blockchain_id === '80001F51') {
            // if ETH symbol && balance_sync_block < findBlockHeight, request RPC get balance
            const findBlockHeight = await _db.Blockchain.findOne({ where: { blockchain_id: findAccount.blockchain_id } });
            if (Number(accountCurrency.balance_sync_block) < Number(findBlockHeight.block)) {
              const findAddress = await _db.AccountAddress.findOne({
                where: { account_id: accountCurrency.Account.account_id },
                attributes: ['address'],
              });
              if (findAddress) {
                if (findCurrency.type === 2) {
                  balance = await Utils.getERC20Token(findAccount.blockchain_id, findAddress.address, findCurrency.contract, findCurrency.decimals);
                } else {
                  balance = await Utils.ethGetBalanceByAddress(findAccount.blockchain_id, findAddress.address, findCurrency.decimals);
                }
                await _db.AccountCurrency.update(
                  { balance, balance_sync_block: findBlockHeight.block },
                  { where: { accountCurrency_id: accountCurrency.accountCurrency_id } },
                );
              } else {
                balance = accountCurrency.balance;
              }
            }
          } else {
            const findAllAddress = await _db.AccountAddress.findAll({
              where: { account_id: findAccount.account_id },
              attributes: ['accountAddress_id'],
            });
            balance = new BigNumber(0);
            for (const addressItem of findAllAddress) {
              const findUTXOByAddress = await _db.UTXO.findAll({
                where: { accountAddress_id: addressItem.accountAddress_id, to_tx: { [this.Sequelize.Op.is]: null } },
                attributes: ['amount'],
              });

              for (const utxoItem of findUTXOByAddress) {
                balance = balance.plus(new BigNumber(utxoItem.amount));
              }
            }
            balance = Utils.dividedByDecimal(balance, findCurrency.decimals);
          }

          if (findCurrency && findCurrency.type === 1) {
            payload.blockchain_id = findAccount.blockchain_id;
            payload.currency_id = accountCurrency.currency_id;
            payload.account_id = accountCurrency.accountCurrency_id;
            payload.purpose = findAccount.purpose;
            payload.account_index = '0';
            payload.curve_type = findAccount.curve_type;
            payload.number_of_external_key = findAccount.number_of_external_key;
            payload.number_of_internal_key = findAccount.number_of_internal_key;
            payload.balance = balance;
            payload.symbol = findCurrency.symbol;
            payload.icon = findCurrency.icon;
          } else if (findCurrency && findCurrency.type === 2) {
            tokens.push({
              account_token_id: accountCurrency.accountCurrency_id,
              token_id: findCurrency.currency_id,
              blockchain_id: findAccount.blockchain_id,
              name: findCurrency.name,
              symbol: findCurrency.symbol,
              icon: findCurrency.icon,
              type: findCurrency.type,
              publish: findCurrency.publish,
              decimals: findCurrency.decimals,
              total_supply: findCurrency.total_supply,
              contract: findCurrency.contract,
              balance,
            });
          }
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
      const findAccountCurrency = await this.DBOperator.findOne({
        tableName: 'AccountCurrency',
        options: {
          where: {
            accountCurrency_id: account_id,
          },
          include: [
            {
              _model: 'Account',
              attributes: ['account_id', 'user_id', 'extend_public_key', 'blockchain_id'],
              where: {
                user_id: tokenInfo.userID,
              },
            },
          ],
        },
      });
      if (!findAccountCurrency) return new ResponseFormat({ message: 'account not found', code: Codes.ACCOUNT_NOT_FOUND });

      const findReceiveAddress = await this.DBOperator.findOne({
        tableName: 'AccountAddress',
        options: {
          where: {
            account_id: findAccountCurrency.Account.account_id,
            chain_index: 0,
            key_index: findAccountCurrency.number_of_external_key,
          },
        },
      });

      const findBlockInfo = Utils.blockchainIDToBlockInfo(findAccountCurrency.Account.blockchain_id);
      if (!findBlockInfo) return new ResponseFormat({ message: 'blockchain id not found', code: Codes.BLOCKCHAIN_ID_NOT_FOUND });

      const hdWallet = new HDWallet({ extendPublicKey: findAccountCurrency.Account.extend_public_key });
      // if index address not found
      let { address } = findReceiveAddress || {};
      if (!findReceiveAddress) {
        const { coin_type: coinType } = findBlockInfo;
        const wallet = hdWallet.getWalletInfo({
          change: 0,
          index: findAccountCurrency.number_of_external_key,
          coinType,
          blockchainID: findAccountCurrency.Account.blockchain_id,
        });

        const DBName = Utils.blockchainIDToDBName(findAccountCurrency.Account.blockchain_id);
        const _db = this.database.db[DBName];
        await _db.AccountAddress.create({
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
      const findAccountCurrency = await this.DBOperator.findOne({
        tableName: 'AccountCurrency',
        options: {
          where: {
            accountCurrency_id: account_id,
          },
          include: [
            {
              _model: 'Account',
              attributes: ['account_id', 'user_id', 'extend_public_key', 'blockchain_id'],
              where: {
                user_id: tokenInfo.userID,
              },
            },
          ],
        },
      });
      if (!findAccountCurrency) return new ResponseFormat({ message: 'account not found', code: Codes.ACCOUNT_NOT_FOUND });

      const findBlockInfo = Utils.blockchainIDToBlockInfo(findAccountCurrency.Account.blockchain_id);
      if (!findBlockInfo) return new ResponseFormat({ message: 'blockchain id not found', code: Codes.BLOCKCHAIN_ID_NOT_FOUND });

      let chain_index = 0;
      // only BTC Base has change address
      switch (findAccountCurrency.Account.blockchain_id) {
        case '80000000':
        case 'F0000000':
        case '80000091':
        case 'F0000091':
          chain_index = 1;
          break;
        default:
          break;
      }

      const findChangeAddress = await this.DBOperator.findOne({
        tableName: 'AccountAddress',
        options: {
          where: {
            account_id: findAccountCurrency.Account.account_id,
            chain_index,
            key_index: findAccountCurrency.number_of_internal_key,
          },
        },
      });

      const hdWallet = new HDWallet({ extendPublicKey: findAccountCurrency.Account.extend_public_key });
      // if index address not found
      let { address } = findChangeAddress || {};
      if (!findChangeAddress) {
        const { coin_type: coinType } = findBlockInfo;
        const wallet = hdWallet.getWalletInfo({
          change: chain_index,
          index: findAccountCurrency.number_of_internal_key,
          coinType,
          blockchainID: findAccountCurrency.Account.blockchain_id,
        });

        const DBName = Utils.blockchainIDToDBName(findAccountCurrency.Account.blockchain_id);
        const _db = this.database.db[DBName];
        await _db.AccountAddress.create({
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
      console.log(e); // -- no console.log
      this.logger.error('AccountChange e:', e);
      if (e.code) return e;
      return new ResponseFormat({ message: `DB Error(${e.message})`, code: Codes.DB_ERROR });
    }
  }

  async _findAccountTXs({
    findAccountCurrency, txs, chain_index, key_index, timestamp, limit, meta,
  }) {
    // find blockchain info
    const findBlockchainInfo = await this.DBOperator.findOne({
      tableName: 'Blockchain',
      options: {
        where: { blockchain_id: findAccountCurrency.Account.blockchain_id },
      },
    });
    const DBName = Utils.blockchainIDToDBName(findAccountCurrency.Account.blockchain_id);
    const _db = this.database.db[DBName];

    // find currency
    const findCurrency = await _db.Currency.findOne({
      where: { currency_id: findAccountCurrency.currency_id },
    });

    const isToken = findCurrency.type === 2;
    const findAccountAddress = await _db.AccountAddress.findOne({
      where: { account_id: findAccountCurrency.account_id, chain_index, key_index },
    });
    // find all tx by address
    if (findAccountAddress) {
      if (isToken) {
        const findTxByAddress = await _db.AddressTokenTransaction.findAll({
          where: {
            currency_id: findAccountCurrency.currency_id,
            accountAddress_id: findAccountAddress.accountAddress_id,
          },
          // limit: Number(limit) + 1,
          include: [
            {
              model: _db.TokenTransaction,
              include: [
                {
                  model: _db.Transaction,
                  where: {
                    timestamp: { [this.Sequelize.Op.lt]: timestamp },
                  },
                },
              ],
            },
          ],
        });

        const count = await _db.AddressTokenTransaction.count({
          where: {
            currency_id: findAccountCurrency.currency_id,
            accountAddress_id: findAccountAddress.accountAddress_id,
          },
        });
        meta.count += count;
        if (findTxByAddress && findTxByAddress.length > 0) {
          for (let j = 0; j < findTxByAddress.length; j++) {
            const txInfo = findTxByAddress[j];
            const amount = Utils.dividedByDecimal(txInfo.amount, findCurrency.decimals);
            const gas_price = txInfo.TokenTransaction.Transaction.gas_price
              ? Utils.dividedByDecimal(txInfo.TokenTransaction.Transaction.gas_price, findCurrency.decimals)
              : null;
            const fee = txInfo.TokenTransaction.Transaction.fee
              ? Utils.dividedByDecimal(txInfo.TokenTransaction.Transaction.fee, findCurrency.decimals)
              : null;
            txs.push({
              txid: txInfo.TokenTransaction.Transaction.txid,
              // eslint-disable-next-line no-nested-ternary
              status: (isToken) ? (txInfo.TokenTransaction.result ? 'success' : 'failed') : 'success',
              amount,
              symbol: findCurrency.symbol, // "unit"
              direction: txInfo.direction === 0 ? 'send' : 'receive',
              confirmations: findBlockchainInfo.block - txInfo.TokenTransaction.Transaction.block + 1,
              timestamp: txInfo.TokenTransaction.timestamp,
              source_addresses: Utils.formatAddressArray(txInfo.TokenTransaction.source_addresses),
              destination_addresses: Utils.formatAddressArray(txInfo.TokenTransaction.destination_addresses),
              fee,
              gas_price,
              gas_used: txInfo.TokenTransaction.Transaction.gas_used,
              note: txInfo.TokenTransaction.Transaction.note,
            });
          }
        }
      } else {
        const findTxByAddress = await _db.AddressTransaction.findAll({
          where: {
            currency_id: findAccountCurrency.currency_id,
            accountAddress_id: findAccountAddress.accountAddress_id,
          },
          limit: Number(limit) + 1,
          include: [
            {
              model: _db.Transaction,
              where: {
                timestamp: { [this.Sequelize.Op.lt]: timestamp },
              },
            },
          ],
        });
        const count = await _db.AddressTransaction.count({
          where: {
            currency_id: findAccountCurrency.currency_id,
            accountAddress_id: findAccountAddress.accountAddress_id,
          },
        });
        meta.count += count;
        if (findTxByAddress) {
          for (let j = 0; j < findTxByAddress.length; j++) {
            const txInfo = findTxByAddress[j];
            const amount = Utils.dividedByDecimal(txInfo.amount, findCurrency.decimals);
            const gas_price = txInfo.Transaction.gas_price
              ? Utils.dividedByDecimal(txInfo.Transaction.gas_price, findCurrency.decimals)
              : null;
            const fee = txInfo.Transaction.fee
              ? Utils.dividedByDecimal(txInfo.Transaction.fee, findCurrency.decimals)
              : null;

            txs.push({
              txid: txInfo.Transaction.txid,
              // eslint-disable-next-line no-nested-ternary
              status: (isToken) ? findTxByAddress.result ? 'success' : 'failed' : 'success',
              amount,
              symbol: findCurrency.symbol, // "unit"
              direction: txInfo.direction === 0 ? 'send' : 'receive',
              confirmations: findBlockchainInfo.block - txInfo.Transaction.block + 1,
              timestamp: txInfo.Transaction.timestamp,
              source_addresses: Utils.formatAddressArray(txInfo.Transaction.source_addresses),
              destination_addresses: Utils.formatAddressArray(txInfo.Transaction.destination_addresses),
              fee,
              gas_price,
              gas_used: txInfo.Transaction.gas_used,
              note: txInfo.Transaction.note,
            });
          }
        }
      }
    }
  }

  _mergeInternalTxs({ txs }) {
    const tmpTxs = {};
    txs.forEach((tx) => {
      if (!tmpTxs[tx.txid]) {
        const amount = (tx.direction === 'send') ? new BigNumber(tx.amount) : new BigNumber(0).minus(new BigNumber(tx.amount));
        tmpTxs[tx.txid] = { tx, amount, same: 0 };
      } else {
        let { amount } = tmpTxs[tx.txid];
        if (tx.direction === 'send') {
          amount = amount.plus(new BigNumber(tx.amount));
        } else {
          amount = amount.minus(new BigNumber(tx.amount));
        }

        tmpTxs[tx.txid].amount = amount;
        tmpTxs[tx.txid].direction = 'send';
        tmpTxs[tx.txid].same = 1;
      }
    });

    const result = [];
    Object.keys(tmpTxs).forEach((key) => {
      if (tmpTxs[key].same) {
        tmpTxs[key].tx.amount = tmpTxs[key].amount.abs().minus(new BigNumber(tmpTxs[key].tx.fee)).toFixed();
      } else {
        tmpTxs[key].tx.amount = tmpTxs[key].amount.abs().toFixed();
      }
      // fix for null from address
      if (!tmpTxs[key].tx.source_addresses)tmpTxs[key].tx.source_addresses = '2N4iKXLjajWZHJhz9pYdhr6jHbzKThvm8D4';
      result.push(tmpTxs[key].tx);
    });

    return result;
  }

  async ListTransactions({ params, token, query }) {
    // account_id -> accountCurrency_id
    const { account_id } = params;
    const { timestamp = Math.floor(Date.now() / 1000), limit = 20 } = query;

    if (!token) return new ResponseFormat({ message: 'invalid token', code: Codes.INVALID_ACCESS_TOKEN });
    const tokenInfo = await Utils.verifyToken(token);
    try {
      const findAccountCurrency = await this.DBOperator.findOne({
        tableName: 'AccountCurrency',
        options: {
          where: { accountCurrency_id: account_id },
          include: [
            {
              _model: 'Account',
              attributes: ['account_id', 'user_id', 'blockchain_id'],
              where: {
                user_id: tokenInfo.userID,
              },
            },
          ],
        },
      });
      if (!findAccountCurrency) return new ResponseFormat({ message: 'account not found', code: Codes.ACCOUNT_NOT_FOUND });

      const { number_of_external_key, number_of_internal_key } = findAccountCurrency;
      const result = [];
      const meta = {
        hasNext: false,
        timestamp: 0,
        count: 0,
      };

      // find external address txs
      for (let i = 0; i <= number_of_external_key; i++) {
        // find all address
        await this._findAccountTXs({
          findAccountCurrency, txs: result, chain_index: 0, key_index: i, timestamp, limit, meta,
        });
      }

      // find internal address txs
      for (let i = 0; i <= number_of_internal_key; i++) {
        await this._findAccountTXs({
          findAccountCurrency, txs: result, chain_index: 1, key_index: i, timestamp, limit, meta,
        });
      }

      // merge internal txs
      const items = this._mergeInternalTxs({ txs: result });

      // sort by timestamps
      items.sort((a, b) => b.timestamp - a.timestamp);

      if (items.length > limit) {
        meta.hasNext = true;
        meta.timestamp = items[limit].timestamp;
      }

      return new ResponseFormat({
        message: 'List Transactions',
        // items,
        // meta,
        payload: items,
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
      const findTX = await this.DBOperator.findOne({
        tableName: 'Transaction',
        options: {
          where: { txid },
          include: [
            {
              _model: 'Currency',
              attributes: ['currency_id', 'symbol', 'decimals'],
              include: [
                {
                  _model: 'Blockchain',
                  attributes: ['blockchain_id', 'block'],
                },
              ],
            },
          ],
        },
      });

      if (findTX) {
        const amount = Utils.dividedByDecimal(findTX.amount, findTX.Currency.decimals);
        const gas_price = findTX.gas_price
          ? Utils.dividedByDecimal(findTX.gas_price, findTX.Currency.decimals)
          : null;
        return new ResponseFormat({
          message: 'Get Transaction Detail',
          payload: {
            txid: findTX.txid,
            status: findTX.result ? 'success' : 'failed',
            confirmations: findTX.Currency.Blockchain.block - findTX.block + 1,
            amount,
            blockchain_id: findTX.Currency.Blockchain.blockchain_id,
            symbol: findTX.Currency.symbol,
            direction: findTX.direction === 0 ? 'send' : 'receive',
            timestamp: findTX.timestamp,
            source_addresses: Utils.formatAddressArray(findTX.source_addresses),
            destination_addresses: Utils.formatAddressArray(findTX.destination_addresses),
            fee: findTX.fee,
            gas_price,
            gas_used: findTX.gas_used,
          },
        });
      }
      return new ResponseFormat({ message: 'txid not found', code: Codes.TX_NOT_FOUND });
    } catch (e) {
      console.log(e); // -- no console.log
      this.logger.error('TransactionDetail e:', e);
      if (e.code) return e;
      return new ResponseFormat({ message: `DB Error(${e.message})`, code: Codes.DB_ERROR });
    }
  }

  _formatUTXOType(typeValue) {
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
    // find blockchain info
    const DBName = Utils.blockchainIDToDBName(findAccountCurrency.Account.blockchain_id);
    const _db = this.database.db[DBName];

    // find AccountAddress
    const findAccountAddress = await _db.AccountAddress.findOne({ where: { account_id: findAccountCurrency.Account.account_id, chain_index, key_index } });
    if (!findAccountAddress) return new ResponseFormat({ message: 'account not found(address not found)', code: Codes.ACCOUNT_NOT_FOUND });

    // find all UTXO
    const findUTXO = await _db.UTXO.findAll({
      where: { accountAddress_id: findAccountAddress.accountAddress_id, to_tx: { [this.Sequelize.Op.is]: null } },
      include: [
        {
          model: _db.AccountAddress,
          attributes: ['address'],
        },
      ],
    });

    for (let i = 0; i < findUTXO.length; i++) {
      const utxo = findUTXO[i];
      payload.push({
        txid: utxo.txid,
        utxo_id: utxo.utxo_id,
        vout: utxo.vout,
        type: utxo.type,
        amount: utxo.amount,
        script: utxo.script,
        timestamp: utxo.on_block_timestamp,
        chain_index,
        key_index,
        address: utxo.AccountAddress.address,
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
      const findAccountCurrency = await this.DBOperator.findOne({
        tableName: 'AccountCurrency',
        options: {
          where: {
            accountCurrency_id: account_id,
          },
          include: [
            {
              _model: 'Account',
              where: {
                user_id: tokenInfo.userID,
              },
            },
          ],
        },
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
        message: 'List Unspent Transaction Outputs',
        payload,
      });
    } catch (e) {
      console.log('e:', e); // -- no console.log
      this.logger.error('GetUTXO e:', e);
      if (e.code) return e;
      return new ResponseFormat({ message: `DB Error(${e.message})`, code: Codes.DB_ERROR });
    }
  }
}

module.exports = Account;
