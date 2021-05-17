// ++ temp for count rollback times
const fs = require('fs');

const dvalue = require('dvalue');
const BigNumber = require('bignumber.js');

const CrawlerManagerBase = require('./CrawlerManagerBase');
const Utils = require('./Utils');

class EthCrawlerManagerBase extends CrawlerManagerBase {
  constructor(blockchainId, database, logger) {
    super(blockchainId, database, logger);
    this.options = {};
    this.syncInterval = 15000;
  }

  async init() {
    await super.init();
    this.peerBlock = 0;
    try {
      this.oneCycle();
    } catch (error) {
      this.logger.log(`[${this.constructor.name}] ${error}`);
    }
    setInterval(async () => {
      try {
        this.oneCycle();
      } catch (error) {
        this.logger.log(`[${this.constructor.name}] ${error}`);
      }
    }, this.syncInterval);
  }

  async assignParser() {
    // TODO
    return Promise.resolve();
  }

  async avgFeeFromPeer() {
    this.logger.debug(`[${this.constructor.name}] avgFeeFromPeer`);
    const type = 'getFee';
    const options = dvalue.clone(this.options);
    options.data = this.constructor.cmd({ type });
    const checkId = options.data.id;
    const data = await Utils.ETHRPC(options);
    if (data instanceof Object) {
      if (data.id !== checkId) {
        this.logger.error(`[${this.constructor.name}] avgFeeFromPeer not found`);
        return Promise.reject();
      }
      if (data.result) {
        const bnGasPrice = new BigNumber(data.result, 16);
        return Promise.resolve(bnGasPrice.toFixed());
      }
    }
    this.logger.error(`[${this.constructor.name}] avgFeeFromPeer not found`);
    return Promise.reject(data.error);
  }

  async blockNumberFromPeer() {
    this.logger.debug(`[${this.constructor.name}] blockNumberFromPeer`);
    const type = 'getBlockcount';
    const options = dvalue.clone(this.options);
    options.data = this.constructor.cmd({ type });
    const checkId = options.data.id;
    const data = await Utils.ETHRPC(options);
    if (data instanceof Object) {
      if (data.id !== checkId) {
        this.logger.error(`[${this.constructor.name}] \x1b[1m\x1b[90mblock number not found\x1b[0m\x1b[21m`);
        return Promise.reject();
      }
      return Promise.resolve(data.result);
    }
    this.logger.error(`[${this.constructor.name}]\x1b[1m\x1b[90m block number not found\x1b[0m\x1b[21m`);
    return Promise.reject();
  }

  async blockDataFromPeer(block) {
    this.logger.debug(`[${this.constructor.name}] blockDataFromPeer(${block})`);
    const type = 'getBlock';
    const options = dvalue.clone(this.options);
    options.data = this.constructor.cmd({ type, block });
    const checkId = options.data.id;
    const data = await Utils.ETHRPC(options);
    if (data instanceof Object) {
      if (data.id !== checkId) {
        this.logger.error(`[${this.constructor.name}] \x1b[1m\x1b[90mblock data not found\x1b[0m\x1b[21m`);
        return Promise.reject();
      }
      return Promise.resolve(data.result);
    }
    this.logger.error(`[${this.constructor.name}] \x1b[1m\x1b[90mblock data not found\x1b[0m\x1b[21m`);
    return Promise.reject();
  }

  async blockHashFromPeer(block) {
    this.logger.debug(`[${this.constructor.name}] blockhashFromPeer(${block})`);
    const type = 'getBlock';
    const options = dvalue.clone(this.options);
    options.data = this.constructor.cmd({ type, block });
    const checkId = options.data.id;
    const data = await Utils.ETHRPC(options);
    if (data instanceof Object) {
      if (data.id !== checkId) {
        this.logger.error(`[${this.constructor.name}] \x1b[1m\x1b[90mblock hash not found\x1b[0m\x1b[21m`);
        return Promise.reject();
      }
      const blockData = data.result;
      return Promise.resolve(blockData.hash);
    }
    this.logger.error(`[${this.constructor.name}] \x1b[1m\x1b[90mblock hash not found\x1b[0m\x1b[21m`);
    return Promise.reject();
  }

  async insertBlock(blockData) {
    this.logger.debug(`[${this.constructor.name}] insertBlock(${blockData.hash})`);

    try {
      const txs = blockData.transactions;
      const txids = [];
      for (const tx of txs) {
        txids.push(tx.hash);
      }

      let insertResult = await this.blockScannedModel.findOne({
        where: { blockchain_id: this.bcid, block: parseInt(blockData.number, 16) },
      });

      if (!insertResult) {
        insertResult = await this.blockScannedModel.create({
          blockchain_id: this.bcid,
          block: parseInt(blockData.number, 16),
          block_hash: blockData.hash,
          timestamp: parseInt(blockData.timestamp, 16),
          result: JSON.stringify(txids),
          transaction_count: txids.length,
          miner: blockData.miner,
          difficulty: new BigNumber(blockData.difficulty, 16).toFixed(),
          transactions_root: blockData.transactionsRoot,
          size: parseInt(blockData.size, 16),
          gas_used: parseInt(blockData.gasUsed, 16),
          extra_data: blockData.extraData,
          uncles: JSON.stringify(blockData.uncles),
        });
      } else {
        const updateResult = await this.blockScannedModel.update({
          blockchain_id: this.bcid,
          block: parseInt(blockData.number, 16),
          block_hash: blockData.hash,
          timestamp: parseInt(blockData.timestamp, 16),
          result: JSON.stringify(txids),
          transaction_count: txids.length,
          miner: blockData.miner,
          difficulty: new BigNumber(blockData.difficulty, 16).toFixed(),
          transactions_root: blockData.transactionsRoot,
          size: parseInt(blockData.size, 16),
          gas_used: parseInt(blockData.gasUsed, 16),
          extra_data: blockData.extraData,
          uncles: JSON.stringify(blockData.uncles),
        }, {
          where: {
            blockScanned_id: insertResult.blockScanned_id,
          },
          returning: true,
        });
        [, [insertResult]] = updateResult;
      }
      return insertResult;
    } catch (error) {
      const e = new Error(`[${this.constructor.name}] insertBlock(${blockData.hash}) error: ${error}`);
      this.logger.error(e);
      return Promise.reject(e);
    }
  }

  async insertUnparsedTransaction(transaction, receipt, timestamp) {
    this.logger.debug(`[${this.constructor.name}] insertUnparsedTransaction`);

    try {
      const insertResult = await this.unparsedTxModel.findOrCreate({
        where: { blockchain_id: this.bcid, txid: transaction.hash },
        defaults: {
          blockchain_id: this.bcid,
          txid: transaction.hash,
          transaction: JSON.stringify(transaction),
          receipt: JSON.stringify(receipt),
          timestamp,
          retry: 0,
        },
      });
      return insertResult;
    } catch (error) {
      const e = new Error(`[${this.constructor.name}] insertUnparsedTransaction(${transaction.hash}) error: ${error}`);
      this.logger.error(e);
      return Promise.reject(e);
    }
  }

  async oneCycle() {
    try {
      if (this.isSyncing) {
        this.logger.log(`[${this.constructor.name}] is sycning`);
        return Promise.resolve();
      }
      this.isSyncing = true;
      // step
      // 1. blockNumberFromDB
      // 2. blockNumberFromPeer
      // 3. checkBlockNumber
      // 4. if equal wait to next cycle
      // 5. blockHashFromDB
      // 6. blockHashFromPeer
      // 7. checkBlockHash
      // 7-1 if not equal rollbackBlock
      // 8. syncNextBlock
      // 9. checkBlockNumber
      // 9-1. if is current block on peer, start sync pending transaction
      // 10. wait to next cycle

      if (!await this.checkBlockNumberLess()) {
        this.logger.log(`[${this.constructor.name}] block height ${this.dbBlock} is top now.`);
        this.isSyncing = false;
        return Promise.resolve();
      }

      if (!await this.checkBlockHash(this.dbBlock)) {
        this.logger.error(`[${this.constructor.name}] block ${this.dbBlock} in db not the same as peer.`);
        // ++ temp for count rollback times
        const now = new Date();
        const writeData = `${now.toUTCString()}\n`;
        fs.appendFileSync(
          `${this.rollbackCountDir}/${this.bcid}_${now.getUTCFullYear()}_${now.getUTCMonth()}_${now.getUTCDate()}.txt`,
          writeData,
        );
        this.stopParser();
        this.dbBlock = await this.rollbackBlock(this.dbBlock).catch((error) => error);
        this.startParser();
      }

      await this.syncBlock(this.dbBlock);

      this.isSyncing = false;
      return Promise.resolve();
    } catch (error) {
      this.isSyncing = false;
      this.logger.error(error);
      return Promise.resolve();
    }
  }

  async pendingTransactionFromPeer() {
    this.logger.debug(`[${this.constructor.name}] pendingTransactionFromPeer`);
    try {
      const type = 'getPendingTxs';
      const options = dvalue.clone(this.options);
      options.data = this.constructor.cmd({ type });
      const checkId = options.data.id;
      const data = await Utils.ETHRPC(options);
      if (data instanceof Object) {
        if (data.id !== checkId) {
          this.logger.error(`[${this.constructor.name}] pendingTransactionFromPeer fail`);
          return null;
        }
        if (data.result) {
          return Promise.resolve(data.result.transactions);
        }
      }
      this.logger.error(`[${this.constructor.name}] pendingTransactionFromPeer fail, ${JSON.stringify(data.error)}`);
    } catch (error) {
      this.logger.error(`[${this.constructor.name}] pendingTransactionFromPeer error: ${error}`);
      return Promise.reject(error);
    }
  }

  async syncAvgFee() {
    this.logger.debug(`[${this.constructor.name}] syncAvgFee`);
    try {
      const avgFee = await this.avgFeeFromPeer();
      await this.updateFee(avgFee);
    } catch (error) {
      this.logger.error(`[${this.constructor.name}] syncAvgFee error ${error}`);
    }
  }

  async syncBlock(block) {
    // step
    // 1. sync block +1
    // 2. save block data into db
    // 3. sync tx and receipt
    // 4. save unparsed tx and receipt into db
    // 5. assign parser
    // 6. after parse done update blockchain table block column
    // 7. check block in db is equal to this.peerBlock
    // 8. if yes return
    // 9. if no, recursive

    try {
      let syncBlock = block;
      do {
        const step1 = new Date().getTime();
        // 1. sync block +1
        this.logger.debug(`[${this.constructor.name}] syncBlock(${syncBlock})`);
        syncBlock += 1;
        const syncResult = await this.blockDataFromPeer(syncBlock);
        if (!syncResult) {
          // block hash or data not found
          // maybe network error or block doesn't exist
          // end this recursive
          return Promise.resolve(syncBlock - 1);
        }
        const step1_1 = new Date().getTime();
        this.logger.log(`[${this.constructor.name}] syncBlock ${syncBlock} step:1 blockDataFromPeer: ${(step1_1 - step1) / 1000}sec`);

        // 2. save block data into db
        // must success
        await this.insertBlock(syncResult);
        const step2 = new Date().getTime();
        this.logger.log(`[${this.constructor.name}] syncBlock ${syncBlock} step:2 insertBlock: ${(step2 - step1_1) / 1000}sec`);

        // 3. sync tx and receipt
        const txs = syncResult.transactions;
        const timestamp = parseInt(syncResult.timestamp, 16);

        const insertTx = [];
        for (const transaction of txs) {
          // check tx is not in db
          const findTX = await this.unparsedTxModel.findOne({
            where: { blockchain_id: this.bcid, txid: transaction.hash },
          });
          if (!findTX) {
            insertTx.push({
              blockchain_id: this.bcid,
              txid: transaction.hash,
              transaction: JSON.stringify(transaction),
              // -- move to parser by wayne
              // receipt: JSON.stringify(receipts[j]),
              receipt: '',
              timestamp,
              retry: 0,
            });
          }
        }
        const step3 = new Date().getTime();
        this.logger.log(`[${this.constructor.name}] syncBlock ${syncBlock} step:3 full tx receipt sync: ${(step3 - step2) / 1000}sec`);

        // 4. save unparsed tx and receipt into db
        await this.unparsedTxModel.bulkCreate(insertTx);
        const step4 = new Date().getTime();
        this.logger.log(`[${this.constructor.name}] syncBlock ${syncBlock} step:4 insertUnparsedTransaction: ${(step4 - step3) / 1000}sec`);
        // 5. assign parser
        // must success

        // 6. after parse done update blockchain table block column
        await this.updateBlockHeight(syncBlock);
        const step6 = new Date().getTime();
        this.logger.log(`[${this.constructor.name}] syncBlock ${syncBlock} step:6 updateBlockHeight: ${(step6 - step3) / 1000}sec`);

        this.logger.log(`[${this.constructor.name}] syncBlock ${syncBlock} total receipts sync: ${txs.length}`);
        this.logger.log(`[${this.constructor.name}] syncBlock ${syncBlock} whole: ${(step6 - step1) / 1000}sec`);
      } while (syncBlock < this.peerBlock);
      return Promise.resolve(syncBlock);
    } catch (error) {
      this.logger.error(`[${this.constructor.name}] syncBlock() error: ${error}`);
      return Promise.reject();
    }
  }

  async transactionFromPeer(txid) {
    this.logger.debug(`[${this.constructor.name}] transactionFromPeer(${txid})`);
    const type = 'getTransaction';
    const options = dvalue.clone(this.options);
    options.data = this.constructor.cmd({ type, txid });
    const checkId = options.data.id;
    const data = await Utils.ETHRPC(options);
    if (data instanceof Object) {
      if (data.id !== checkId) {
        this.logger.error(`[${this.constructor.name}] \x1b[1m\x1b[90mtransaction not found\x1b[0m\x1b[21m`);
        return Promise.reject();
      }
      return Promise.resolve(data.result);
    }
    this.logger.error(`[${this.constructor.name}] \x1b[1m\x1b[90mtransaction not found\x1b[0m\x1b[21m`);
    return Promise.reject();
  }

  async updateBlockHeight(block) {
    this.logger.debug(`[${this.constructor.name}] updateBlockHeight(${block})`);
    const insertResult = await this.blockchainModel.update(
      { block },
      { where: { blockchain_id: this.bcid } },
    );
    return insertResult;
  }

  async updatePendingTransaction() {
    this.logger.debug(`[${this.constructor.name}] updatePendingTransaction`);
    try {
      // 1. find all transaction where status is null(means pending transaction)
      const transactions = await this.getTransactionsResultNull();

      // 2. get pending transaction
      const pendingTxs = await this.pendingTransactionFromPeer();
      const blockHeightStr = await this.blockNumberFromPeer();
      const blockHeight = parseInt(blockHeightStr, 16);
      console.log('blockHeight:', blockHeight);
      console.log('pendingTxs:', pendingTxs.length);

      // 3. create transaction which is not in step 1 array
      const newTxs = pendingTxs.filter((pendingTx) => transactions.every((transaction) => pendingTx.hash !== transaction.txid));
      const insertTx = [];
      for (const tx of newTxs) {
        try {
          const bnAmount = new BigNumber(tx.value, 16);
          const bnGasPrice = new BigNumber(tx.gasPrice, 16);
          const bnGas = new BigNumber(tx.gas, 16);
          const fee = bnGasPrice.multipliedBy(bnGas).toFixed();
          const destination_addresses = tx.to ? tx.to : '';

          insertTx.push({
            currency_id: this.currencyInfo.currency_id,
            txid: tx.hash,
            source_addresses: tx.from,
            destination_addresses,
            amount: bnAmount.toFixed(),
            note: tx.input,
            block: parseInt(tx.blockNumber, 16),
            nonce: parseInt(tx.nonce, 16),
            fee,
            gas_price: bnGasPrice.toFixed(),
          });

          if (destination_addresses) {
            // new receive transaction and notify app
            const findBlockTimestamp = await this.blockScannedModel.findOne({
              where: { block: parseInt(tx.blockNumber, 16) },
            });
            const timestamp = findBlockTimestamp || Math.floor(Date.now() / 1000);

            const findAddressTransactions = await this.accountAddressModel.findOne({
              where: { address: destination_addresses },
              include: [
                {
                  model: this.accountModel,
                  attributes: ['user_id', 'blockchain_id'],
                },
              ],
            });

            if (findAddressTransactions) {
              const findAccountCurrency = await this.accountCurrencyModel.findOne({
                where: { account_id: findAddressTransactions.account_id },
              });

              console.log('fcm tx new!!!!!!!!!!', JSON.stringify({
                title: `receive ${bnAmount.dividedBy(10 ** this.currencyInfo.decimals).toFixed()} ${this.currencyInfo.symbol}`,
                body: JSON.stringify({
                  blockchainId: this.bcid,
                  eventType: 'TRANSACTION_NEW',
                  currencyId: this.currencyInfo.currency_id,
                  accountId: findAccountCurrency.accountCurrency_id,
                  data: {
                    txid: tx.hash,
                    status: null,
                    amount: bnAmount.toFixed(),
                    symbol: this.currencyInfo.symbol,
                    direction: 'receive',
                    confirmations: 0,
                    timestamp,
                    source_addresses: tx.from,
                    destination_addresses: tx.to ? tx.to : '',
                    fee,
                    gas_price: bnGasPrice.toFixed(),
                    gas_used: null,
                    note: tx.input,
                    balance: this.currencyInfo.type === 1
                      ? await Utils.ethGetBalanceByAddress(findAddressTransactions.Account.blockchain_id, findAddressTransactions.address, this.currencyInfo.decimals)
                      : await Utils.getERC20Token(findAddressTransactions.Account.blockchain_id, findAddressTransactions.address, this.currencyInfo.contract, this.currencyInfo.decimals),
                  },
                }),
                click_action: 'FLUTTER_NOTIFICATION_CLICK',
              })); // -- no console.log

              await this.fcm.messageToUserTopic(findAddressTransactions.Account.user_id, {
                title: `receive ${bnAmount.dividedBy(10 ** this.currencyInfo.decimals).toFixed()} ${this.currencyInfo.symbol}`,
              }, {
                title: `receive ${bnAmount.dividedBy(10 ** this.currencyInfo.decimals).toFixed()} ${this.currencyInfo.symbol}`,
                body: JSON.stringify({
                  blockchainId: this.bcid,
                  eventType: 'TRANSACTION_NEW',
                  currencyId: this.currencyInfo.currency_id,
                  accountId: findAccountCurrency.accountCurrency_id,
                  data: {
                    txid: tx.hash,
                    status: null,
                    amount: bnAmount.toFixed(),
                    symbol: this.currencyInfo.symbol,
                    direction: 'receive',
                    confirmations: 0,
                    timestamp,
                    source_addresses: tx.from,
                    destination_addresses: tx.to ? tx.to : '',
                    fee,
                    gas_price: bnGasPrice.toFixed(),
                    gas_used: null,
                    note: tx.input,
                    balance: this.currencyInfo.type === 1
                      ? await Utils.ethGetBalanceByAddress(findAddressTransactions.Account.blockchain_id, findAddressTransactions.address, this.currencyInfo.decimals)
                      : await Utils.getERC20Token(findAddressTransactions.Account.blockchain_id, findAddressTransactions.address, this.currencyInfo.contract, this.currencyInfo.decimals),
                  },
                }),
                click_action: 'FLUTTER_NOTIFICATION_CLICK',
              });
            }
          }
        } catch (error) {
          this.logger.error(`[${this.constructor.name}] parsePendingTransaction create transaction(${tx.hash}) error: ${error}`);
        }
      }

      await this.transactionModel.bulkCreate(insertTx, {
        updateOnDuplicate: ['currency_id', 'txid'],
      });
      const findPending = await this.pendingTransactionModel.findOne({
        where: {
          blockchain_id: this.bcid,
          blockAsked: blockHeight,
        },
      });
      if (!findPending) {
        await this.pendingTransactionModel.create({
          blockchain_id: this.bcid,
          blockAsked: blockHeight,
          transactions: JSON.stringify(pendingTxs),
          timestamp: Math.floor(Date.now() / 1000),
        });
      } else {
        await this.pendingTransactionModel.update({
          transactions: JSON.stringify(pendingTxs),
          timestamp: Math.floor(Date.now() / 1000),
        }, {
          where: {
            blockchain_id: this.bcid,
            blockAsked: blockHeight,
          },
        });
      }
    } catch (error) {
      console.log('error:', error);
      this.logger.debug(`[${this.constructor.name}] updatePendingTransaction error: ${error}`);
      return Promise.reject(error);
    }
  }

  static cmd({
    type, block, txid,
  }) {
    let result;
    switch (type) {
      case 'getBlockcount':
        result = {
          jsonrpc: '2.0',
          method: 'eth_blockNumber',
          params: [],
          id: dvalue.randomID(),
        };
        break;
      case 'getBlock':
        result = {
          jsonrpc: '2.0',
          method: 'eth_getBlockByNumber',
          params: [`0x${block.toString(16)}`, true],
          id: dvalue.randomID(),
        };
        break;
      case 'getFee':
        result = {
          jsonrpc: '2.0',
          method: 'eth_gasPrice',
          params: [],
          id: dvalue.randomID(),
        };
        break;
      case 'getTransaction':
        result = {
          jsonrpc: '2.0',
          method: 'eth_getTransactionByHash',
          params: [txid],
          id: dvalue.randomID(),
        };
        break;
      case 'getPendingTxs':
        result = {
          jsonrpc: '2.0',
          method: 'eth_getBlockByNumber',
          params: [
            'pending',
            true,
          ],
          id: dvalue.randomID(),
        };
        break;
      default:
        result = {};
    }
    return result;
  }
}

module.exports = EthCrawlerManagerBase;
