const BigNumber = require('bignumber.js');
const dvalue = require('dvalue');
const ParserManagerBase = require('./ParserManagerBase');
const Utils = require('./Utils');

class BtcParserManagerBase extends ParserManagerBase {
  constructor(blockchainId, config, database, logger) {
    super(blockchainId, config, database, logger);

    this.utxoModel = this.database.UTXO;
    this.accountModel = this.database.Account;
    this.accountAddressModel = this.database.AccountAddress;
    this.receiptModel = this.database.Receipt;
    this.tokenTransactionModel = this.database.TokenTransaction;
    this.addressTokenTransactionModel = this.database.AddressTokenTransaction;
    this.accountCurrencyModel = this.database.AccountCurrency;
    this.addressTransactionModel = this.database.AddressTransaction;

    this.options = {};
    this.syncInterval = config.syncInterval.pending ? config.syncInterval.pending : 15000;
    this.decimal = 8;

    this.updateBalanceAccounts = {};

    this.jobTimeout = 10 * 60 * 1000; // 10 min
  }

  async init() {
    await super.init();
    this.isParsing = false;
    setInterval(() => {
      this.doParse();
    }, this.syncInterval);

    this.doParse();
    return this;
  }

  async createJob() {
    this.logger.log(`[${this.constructor.name}] createJob`);
    if (!this.startParse) return;
    // 1. load unparsed transactions per block from UnparsedTransaction
    // 2. check has unparsed transaction
    // 2-1. if no parse update balance
    // 2-2. if yes setJob
    try {
      // 1. load unparsed transactions per block from UnparsedTransaction
      this.block = await this.blockNumberFromDB();
      const txs = await this.getUnparsedTxs();

      // 2. check has unparsed transaction
      if (!txs || txs.length < 1) {
        // 2-1. if no parse update balance
        await this.updateBalance();
        this.isParsing = false;
      } else {
        this.jobDoneList = [];
        this.numberOfJobs = 0;

        for (const tx of txs) {
          await this.setJob(tx);
        }
        if (!this.jobTimer) {
          this.jobTimer = this.createJobTimer();
        }
      }
    } catch (error) {
      this.logger.error(`[${this.constructor.name}] createJob error: ${error}`);
      this.isParsing = false;
      return Promise.resolve(error);
    }
  }

  async doJobDone() {
    this.logger.debug(`[${this.constructor.name}] doJobDone`);
    if (!this.startParse) return;
    // 3. update failed unparsed retry
    // 4. remove parsed transaction from UnparsedTransaction table
    // 5. update pendingTransaction
    try {
      const successParsedTxs = this.jobDoneList.filter((tx) => tx.success === true);
      const failedList = this.jobDoneList.filter((tx) => tx.success === false);

      // 3. update failed unparsed retry
      for (const failedTx of failedList) {
        await this.updateRetry(failedTx);
      }

      // 4. remove parsed transaction from UnparsedTransaction table
      for (const tx of successParsedTxs) {
        await this.removeParsedTx(tx);
      }

      // 5. update pendingTransaction
      // await this.parsePendingTransaction();

      this.createJob();
    } catch (error) {
      this.logger.error(`[${this.constructor.name}] doJobDone error: ${error}`);
      this.isParsing = false;
      return Promise.resolve();
    }
  }

  async blockDataFromPeer(blockHash) {
    const blockchainConfig = Utils.getBlockchainConfig(this.bcid);
    const option = { ...blockchainConfig };

    option.data = {
      jsonrpc: '1.0',
      method: 'getblock',
      params: [blockHash, 1],
      id: dvalue.randomID(),
    };

    const checkId = option.data.id;
    const data = await Utils.BTCRPC(option);
    if (data instanceof Object) {
      if (data.id !== checkId) return Promise.reject();
      return Promise.resolve(data.result);
    }
    this.logger.error('\x1b[1m\x1b[90mbtc block data not found\x1b[0m\x1b[21m');
    return Promise.reject();
  }

  async doParse() {
    if (!this.startParse) {
      this.logger.log(`[${this.constructor.name}] doParse is stop`);
      return;
    }
    if (this.isParsing) {
      this.logger.log(`[${this.constructor.name}] doParse is parsing`);
      return;
    }
    this.isParsing = true;
    // step:
    // 1. load unparsed transactions per block from UnparsedTransaction
    // 2. check has unparsed transaction
    // 2-1. if no parse update balance
    // 2-2. if yes setJob
    // 3. update failed unparsed retry
    // 4. remove parsed transaction from UnparsedTransaction table

    await this.createJob();
  }

  async blockHeightByBlockHashFromPeer(block) {
    this.logger.debug(`[${this.constructor.name}] blockHeightByBlockHashFromPeer(${block})`);
    const type = 'getBlockHeight';
    const options = dvalue.clone(this.options);
    options.data = this.constructor.cmd({ type, block });
    const checkId = options.data.id;
    const data = await Utils.BTCRPC(options);
    if (data instanceof Object) {
      if (data.id !== checkId) {
        this.logger.error(`[${this.constructor.name}] blockHeightByBlockHashFromPeer not found`);
        return Promise.reject();
      }
      if (data.result) {
        const height = data.result.height || '0';
        return Promise.resolve(height);
      }
    }
    this.logger.error(`[${this.constructor.name}] blockHeightByBlockHashFromPeer not found`);
    return Promise.reject(data.error);
  }

  async getTransactionByTxidFromPeer(txid) {
    this.logger.debug(`[${this.constructor.name}] getTransactionByTxidFromPeer(${txid})`);
    const type = 'getTransaction';
    const options = dvalue.clone(this.options);
    options.data = this.constructor.cmd({ type, txid });
    const checkId = options.data.id;
    const data = await Utils.BTCRPC(options);
    if (data instanceof Object) {
      if (data.id !== checkId) {
        this.logger.error(`[${this.constructor.name}] getTransactionByTxidFromPeer not found`);
        return Promise.reject();
      }
      if (data.result) {
        return Promise.resolve(data.result);
      }
    }
    this.logger.error(`[${this.constructor.name}] getTransactionByTxidFromPeer not found`);
    return Promise.reject(data.error);
  }

  static async parseBTCTxAmounts(tx) {
    let from = new BigNumber(0);
    let to = new BigNumber(0);
    const source_addresses = [];
    const destination_addresses = [];
    let note = '';

    for (const inputData of tx.vin) {
      // if coinbase, continue
      if (inputData.txid) {
        const findUXTO = await this.utxoModel.findOne({ where: { txid: inputData.txid } });
        if (findUXTO) {
          from = from.plus(new BigNumber(findUXTO.amount));
        }

        // TODO: change use promise all
        const txInfo = await this.getTransactionByTxidFromPeer(inputData.txid);
        if (txInfo && txInfo.vout && txInfo.vout.length > inputData.vout) {
          if (txInfo.vout[inputData.vout].scriptPubKey && txInfo.vout[inputData.vout].scriptPubKey.addresses) {
            source_addresses.push({
              addresses: txInfo.vout[inputData.vout].scriptPubKey.addresses,
              amount: Utils.multipliedByDecimal(txInfo.vout[inputData.vout].value, this.decimal),
            });
            from = from.plus(new BigNumber(txInfo.vout[inputData.vout].value || '0'));
          } else if (txInfo.vout[inputData.vout].scriptPubKey && txInfo.vout[inputData.vout].scriptPubKey.type === 'pubkey') {
            // TODO: need pubkey => P2PK address
            source_addresses.push({
              addresses: txInfo.vout[inputData.vout].scriptPubKey.hex,
              amount: Utils.multipliedByDecimal(txInfo.vout[inputData.vout].value || '0', this.decimal),
            });
            from = from.plus(new BigNumber(txInfo.vout[inputData.vout].value || '0'));
          }
        }
      }
    }

    for (const outputData of tx.vout) {
      to = to.plus(new BigNumber(outputData.value));
      if (outputData.scriptPubKey && outputData.scriptPubKey.addresses) {
        destination_addresses.push({
          addresses: outputData.scriptPubKey.addresses,
          amount: Utils.multipliedByDecimal(outputData.value, this.decimal),
        });
      }
      if (outputData.scriptPubKey && outputData.scriptPubKey.asm && outputData.scriptPubKey.asm.slice(0, 9) === 'OP_RETURN1') {
        note = outputData.scriptPubKey.hex || '';
      } else if (outputData.scriptPubKey && outputData.scriptPubKey.type === 'pubkey') {
        // TODO: need pubkey => P2PK address
        destination_addresses.push({
          addresses: outputData.scriptPubKey.hex,
          amount: new BigNumber(outputData.value || '0', this.decimal),
        });
      }
    }

    return {
      from: Utils.multipliedByDecimal(from, this.decimal),
      to: Utils.multipliedByDecimal(to, this.decimal),
      fee: new BigNumber(from).minus(new BigNumber(to)),
      source_addresses: JSON.stringify(source_addresses),
      destination_addresses: JSON.stringify(destination_addresses),
      note,
    };
  }

  async updateBalance() {
    this.logger.debug(`[${this.constructor.name}] updateBalance`);
    // step:
    // 2. update balance
    try {
      // update balance
      for (const accountID of Object.keys(this.updateBalanceAccounts)) {
        if (this.updateBalanceAccounts[accountID] && this.updateBalanceAccounts[accountID].retryCount < 3) {
          const findAllAddress = await this.accountAddressModel.findAll({
            where: { account_id: accountID },
            attributes: ['accountAddress_id'],
          });
          let balance = new BigNumber(0);
          for (const addressItem of findAllAddress) {
            const findUTXOByAddress = await this.utxoModel.findAll({
              where: { accountAddress_id: addressItem.accountAddress_id, to_tx: { [this.Sequelize.Op.is]: null } },
              attributes: ['amount'],
            });

            for (const utxoItem of findUTXOByAddress) {
              balance = balance.plus(new BigNumber(utxoItem.amount));
            }
          }

          try {
            await this.accountCurrencyModel.update({
              balance: Utils.dividedByDecimal(balance, this.currencyInfo.decimals),
            },
            {
              where: {
                account_id: accountID,
                currency_id: this.currencyInfo.currency_id,
              },
            });

            delete this.updateBalanceAccounts[accountID];
          } catch (e) {
            this.logger.error(`this.updateBalanceAccounts[${accountID}] update error: ${e}`);
            this.updateBalanceAccounts[accountID].retryCount += 1;
          }
        } else {
          this.logger.error(`this.updateBalanceAccounts[${accountID}] update error!`);
          this.updateBalanceAccounts[accountID].retryCount += 1;

          // if error after 3 block, reset retryCount, and retry it
          if (this.updateBalanceAccounts[accountID].retryCount > 6) {
            this.updateBalanceAccounts[accountID].retryCount = 0;
          }
        }
      }
    } catch (error) {
      this.logger.error(`[${this.constructor.name}] updateBalance error: ${error}`);
      return Promise.reject(error);
    }
  }

  async parsePendingTransaction() {
    // ++ too large in btc mainnet, may use msg queue to speedup
    this.logger.debug(`[${this.constructor.name}] parsePendingTransaction`);
    // step:
    // 1. find all transaction where status is null(means pending transaction)
    // 2. get last pending transaction from pendingTransaction table
    // 3. update result which is not in step 2 array
    // 4. remove pending transaction
    try {
      // 1. find all transaction where status is null(means pending transaction)
      const transactions = await this.getTransactionsResultNull();

      // 2. get last pending transaction from pendingTransaction table
      const pendingTxids = await this.getPendingTransactionFromDB();

      // 3. update result which is not in step 2 array
      const missingTxs = transactions.filter((transaction) => (pendingTxids.every((pendingTxid) => pendingTxid !== transaction.txid) && this.block - transaction.block + 1 >= 6));
      for (const tx of missingTxs) {
        try {
          if (tx.block) {
            await this.transactionModel.update(
              {
                result: true,
              },
              {
                where: {
                  currency_id: this.currencyInfo.currency_id,
                  txid: tx.txid,
                },
              },
            );
          } else {
            const peerTx = await this.getTransactionByTxidFromPeer(tx.txid).catch((error) => error); ('peerTx.blockhash:', peerTx.blockhash);
            if (peerTx.blockhash) {
              const blockData = await this.blockDataFromDB(peerTx.blockhash);
              if (blockData) {
                tx.block = blockData.block;
                tx.timestamp = peerTx.blocktime;
                tx.result = tx.confirmations >= 6 ? true : null;
              } else {
                const blockData2 = await this.blockDataFromPeer(peerTx.blockhash);
                if (blockData2) {
                  tx.block = blockData2.height;
                  tx.timestamp = peerTx.blocktime;
                  tx.result = tx.confirmations >= 6 ? true : null;
                }
              }
            } else if (peerTx.code === -5) {
              tx.result = false;
            }
            await this.transactionModel.update(
              {
                block: tx.block,
                timestamp: tx.timestamp,
                result: tx.result,
              },
              {
                where: {
                  currency_id: this.currencyInfo.currency_id,
                  txid: tx.txid,
                },
              },
            );
          }
        } catch (error) {
          this.logger.error(`[${this.constructor.name}] parsePendingTransaction update failed transaction(${tx.txid}) error: ${error}`);
        }
      }

      // 4. remove pending transaction
      await this.removePendingTransaction();
    } catch (error) {
      this.logger.error(`[${this.constructor.name}] parsePendingTransaction error: ${error}`);
      return Promise.reject(error);
    }
  }

  static cmd({
    type, txid, block_hash,
  }) {
    let result;
    switch (type) {
      case 'getTransaction':
        result = {
          jsonrpc: '1.0',
          method: 'getrawtransaction',
          params: [txid, true],
          id: dvalue.randomID(),
        };
        break;
      case 'getBlockHeight':
        result = {
          jsonrpc: '1.0',
          method: 'getblockstats',
          params: [block_hash, ['height']],
          id: dvalue.randomID(),
        };
        break;
      default:
        result = {};
    }
    return result;
  }
}

module.exports = BtcParserManagerBase;
