const dvalue = require('dvalue');

const CrawlerManagerBase = require('./CrawlerManagerBase');
const Utils = require('./Utils');
const BtcParserBase = require('./BtcParserBase');

class BtcCrawlerManagerBase extends CrawlerManagerBase {
  constructor(blockchainId, database, logger) {
    super(blockchainId, database, logger);
    this.options = {};
    this.syncInterval = 450000;
  }

  async init() {
    await super.init();
    this.peerBlock = 0;

    // used by BtcParserBase.parseTx.call
    // ++ remove after extract to instance class
    this.transactionModel = this.database.Transaction;
    this.utxoModel = this.database.UTXO;
    this.addressTransactionModel = this.database.AddressTransaction;

    try {
      this.oneCycle();
    } catch (error) {
      this.logger.error(`[${this.constructor.name}] ${error}`);
    }
    setInterval(async () => {
      try {
        this.oneCycle();
      } catch (error) {
        this.logger.error(`[${this.constructor.name}] ${error}`);
      }
    }, this.syncInterval);
  }

  async assignParser() {
    // TODO
    return Promise.resolve();
  }

  async avgFeeFromPeer(block) {
    this.logger.debug(`[${this.constructor.name}] avgFeeFromPeer(${block})`);
    const type = 'getFee';
    const options = dvalue.clone(this.options);
    options.data = this.constructor.cmd({ type, block });
    const checkId = options.data.id;
    const data = await Utils.BTCRPC(options);
    if (data instanceof Object) {
      if (data.id !== checkId) {
        this.logger.error(`[${this.constructor.name}] avgFeeFromPeer not found`);
        return Promise.reject();
      }
      if (data.result) {
        const feerate50 = data.result.feerate_percentiles[2] || '1';
        return Promise.resolve(feerate50);
      }
    }
    this.logger.error(`[${this.constructor.name}] avgFeeFromPeer not found`);
    return Promise.reject(data.error);
  }

  async blockNumberFromPeer() {
    this.logger.debug(`[${this.constructor.name}] blockNumberFromPeer`);
    const type = 'getblockcount';
    const options = dvalue.clone(this.options);
    options.data = this.constructor.cmd({ type });
    const checkId = options.data.id;
    const data = await Utils.BTCRPC(options);
    if (data instanceof Object) {
      if (data.id !== checkId) return Promise.reject();
      return Promise.resolve(data.result);
    }
    this.logger.error('\x1b[1m\x1b[90mbtc block number not found\x1b[0m\x1b[21m');
    return Promise.reject();
  }

  async blockDataFromPeer(blockHash) {
    this.logger.debug(`[${this.constructor.name}] blockDataFromPeer(${blockHash})`);
    const type = 'getblock';
    const options = dvalue.clone(this.options);
    options.data = this.constructor.cmd({ type, blockHash });
    const checkId = options.data.id;
    const data = await Utils.BTCRPC(options);
    if (data instanceof Object) {
      if (data.id !== checkId) return Promise.reject();
      return Promise.resolve(data.result);
    }
    this.logger.error('\x1b[1m\x1b[90mbtc block data not found\x1b[0m\x1b[21m');
    return Promise.reject();
  }

  async blockHashFromPeer(block) {
    this.logger.debug(`[${this.constructor.name}] blockhashFromPeer(${block})`);
    const type = 'getblockhash';
    const options = dvalue.clone(this.options);
    options.data = this.constructor.cmd({ type, block });
    const checkId = options.data.id;
    const data = await Utils.BTCRPC(options);
    if (data instanceof Object) {
      if (data.id !== checkId) return Promise.reject();
      return Promise.resolve(data.result);
    }
    this.logger.error('\x1b[1m\x1b[90mbtc block hash not found\x1b[0m\x1b[21m');
    return Promise.reject();
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

  async insertBlock(blockData) {
    try {
      this.logger.debug(`[${this.constructor.name}] insertBlock(${blockData.hash})`);

      const txs = blockData.tx;
      const txids = [];
      for (const tx of txs) {
        txids.push(tx.txid);
      }

      const insertResult = await this.blockScannedModel.findOrCreate({
        where: { blockchain_id: this.bcid, block: blockData.height },
        defaults: {
          blockchain_id: this.bcid,
          block: blockData.height,
          block_hash: blockData.hash,
          timestamp: blockData.time,
          result: JSON.stringify(txids),
        },
      });
      return insertResult;
    } catch (error) {
      this.logger.error(`[${this.constructor.name}] insertBlock(${blockData.hash}) error: ${error}`);
      return Promise.reject(error);
    }
  }

  async insertUnparsedTransaction(transaction, timestamp) {
    this.logger.debug(`[${this.constructor.name}] insertUnparsedTransaction`);

    try {
      const insertResult = await this.unparsedTxModel.findOrCreate({
        where: { blockchain_id: this.bcid, txid: transaction.hash },
        defaults: {
          blockchain_id: this.bcid,
          txid: transaction.txid,
          transaction: JSON.stringify(transaction),
          receipt: '',
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
      if (this.isSyncing) return Promise.resolve('BtcCrawlerManagerBase is sycning');
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
        this.stopParser();
        this.dbBlock = await this.rollbackBlock(this.dbBlock);
        this.startParser();
      }

      await this.syncBlock(this.dbBlock);

      this.isSyncing = false;
      return Promise.resolve();
    } catch (error) {
      this.isSyncing = false;
      return Promise.reject();
    }
  }

  async pendingTransactionFromPeer() {
    this.logger.debug(`[${this.constructor.name}] pendingTransactionFromPeer`);
    try {
      const type = 'getPendingTxs';
      const options = dvalue.clone(this.options);
      options.data = this.constructor.cmd({ type });
      const checkId = options.data.id;
      const data = await Utils.BTCRPC(options);
      if (data instanceof Object) {
        if (data.id !== checkId) {
          this.logger.error(`[${this.constructor.name}] pendingTransactionFromPeer fail`);
          return null;
        }
        if (data.result) {
          return Promise.resolve(data.result);
        }
      }
      this.logger.error(`[${this.constructor.name}] pendingTransactionFromPeer fail, ${JSON.stringify(data.error)}`);
      return Promise.reject(data.error);
    } catch (error) {
      this.logger.error(`[${this.constructor.name}] pendingTransactionFromPeer error: ${error}`);
      return Promise.reject(error);
    }
  }

  async syncAvgFee() {
    this.logger.debug(`[${this.constructor.name}] syncAvgFee`);
    try {
      const block = await this.blockNumberFromDB();
      const avgFee = await this.avgFeeFromPeer(block);
      await this.updateFee(avgFee);
    } catch (error) {
      this.logger.error(`[${this.constructor.name}] syncAvgFee error: ${error}`);
    }
  }

  async syncBlock(block) {
    // step
    // 1. sync block +1
    // 2. save block data into db
    // 3. save unparsed transaction into db
    // 4. assign parser
    // 5. after parse done update blockchain table block column
    // 6. check block in db is equal to this.peerBlock
    // 7. if yes return
    // 8. if no, recursive

    try {
      let syncBlock = block;
      do {
        const step1 = new Date().getTime();
        // 1. sync block +1
        this.logger.debug(`[${this.constructor.name}] syncBlock(${syncBlock})`);
        syncBlock += 1;
        const syncBlockHash = await this.blockHashFromPeer(syncBlock);
        const syncResult = await this.blockDataFromPeer(syncBlockHash);
        if (!syncBlockHash || !syncResult) {
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

        // 3. save unparsed transaction into db
        const txs = syncResult.tx;
        const timestamp = syncResult.time;
        const insertTx = [];

        for (let j = 0; j < txs.length; j++) {
          // check tx is not in db
          const findTX = await this.unparsedTxModel.findOne({
            where: { blockchain_id: this.bcid, txid: txs[j].hash },
          });
          txs[j].blockhash = syncResult.hash;
          txs[j].confirmations = syncResult.confirmations;
          txs[j].blocktime = syncResult.time;
          txs[j].height = syncResult.height;
          if (!findTX) {
            insertTx.push({
              blockchain_id: this.bcid,
              txid: txs[j].txid,
              transaction: JSON.stringify(txs[j]),
              receipt: '',
              timestamp,
              retry: 0,
            });
          }
        }
        await this.unparsedTxModel.bulkCreate(insertTx);
        const step3 = new Date().getTime();
        this.logger.log(`[${this.constructor.name}] syncBlock ${syncBlock} step:3 insertUnparsedTransaction: ${(step3 - step2) / 1000}sec`);

        // 4. assign parser
        // must success

        // 5. after parse done update blockchain table block column
        await this.updateBlockHeight(syncBlock);
        const step5 = new Date().getTime();
        this.logger.log(`[${this.constructor.name}] syncBlock ${syncBlock} step:5 updateBlockHeight: ${(step5 - step3) / 1000}sec`);
        this.logger.log(`[${this.constructor.name}] syncBlock ${syncBlock} total transaction sync: ${txs.length}`);
        this.logger.log(`[${this.constructor.name}] syncBlock ${syncBlock} whole: ${(step5 - step1) / 1000}sec`);
      } while (syncBlock < this.peerBlock);
      return Promise.resolve(syncBlock);
    } catch (error) {
      this.logger.error(error);
      return Promise.reject();
    }
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

      // 2. get last pending transaction from pendingTransaction table
      const pendingTxids = await this.pendingTransactionFromPeer();
      const blockHeight = await this.blockNumberFromPeer();

      // 3. create transaction which is not in step 1 array
      const newTxids = pendingTxids.filter((pendingTxid) => transactions.every((transaction) => pendingTxid !== transaction.txid));
      for (const txid of newTxids) {
        try {
          const tx = await this.getTransactionByTxidFromPeer(txid);
          await BtcParserBase.parseTx.call(this, tx, this.currencyInfo, tx.timestamp);
        } catch (error) {
          this.logger.error(`[${this.constructor.name}] parsePendingTransaction create transaction(${txid}) error: ${error}`);
        }
      }

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
          transactions: JSON.stringify(pendingTxids),
          timestamp: Math.floor(Date.now() / 1000),
        });
      } else {
        await this.pendingTransactionModel.update({
          transactions: JSON.stringify(pendingTxids),
          timestamp: Math.floor(Date.now() / 1000),
        }, {
          where: {
            blockchain_id: this.bcid,
            blockAsked: blockHeight,
          },
        });
      }
    } catch (error) {
      this.logger.error(`[${this.constructor.name}] updatePendingTransaction error: ${error}`);
      return Promise.reject(error);
    }
  }

  static cmd({
    type, block, blockHash, txid,
  }) {
    let result;
    switch (type) {
      case 'getblockcount':
        result = {
          jsonrpc: '1.0',
          method: 'getblockcount',
          params: [],
          id: dvalue.randomID(),
        };
        break;
      case 'getblockhash':
        result = {
          jsonrpc: '1.0',
          method: 'getblockhash',
          params: [block],
          id: dvalue.randomID(),
        };
        break;
      case 'getblock':
        result = {
          jsonrpc: '1.0',
          method: 'getblock',
          params: [blockHash, 2],
          id: dvalue.randomID(),
        };
        break;
      case 'getFee':
        result = {
          jsonrpc: '1.0',
          method: 'getblockstats',
          params: [block, ['feerate_percentiles']],
          id: dvalue.randomID(),
        };
        break;
      case 'getPendingTxs':
        result = {
          jsonrpc: '1.0',
          method: 'getrawmempool',
          params: [false],
          id: dvalue.randomID(),
        };
        break;
      case 'getTransaction':
        result = {
          jsonrpc: '1.0',
          method: 'getrawtransaction',
          params: [txid, true],
          id: dvalue.randomID(),
        };
        break;
      default:
        result = {};
    }
    return result;
  }
}

module.exports = BtcCrawlerManagerBase;
