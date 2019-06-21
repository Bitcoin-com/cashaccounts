const EmojiList = require('./emoji_names.json');
const crypto = require('crypto');
const axios = require('axios');
const cashaddr = require('cashaddrjs');
const base58check = require('base58check');
const bitcoincashjs = require('bitcoincashjs-lib');
const bchaddr = require('bchaddrjs-slp');
const bchRPC = require('bitcoin-cash-rpc');

const genesisBlock = 563720 - 100;

class CashAccounts {
  /**
   * constructor
   *
   * @param {string} server - if you have your own lookup server
   */

  constructor(server, nodeCredentials) {
    this.server = server || 'https://cashaccounts.bchdata.cash';

    if (nodeCredentials) {
      const { host, username, password, port, timeout } = nodeCredentials;

      this.bchNode = new bchRPC(host, username, password, port, timeout);
    }
  }

  // lookup || account
  buildSearchUrl(handle, lookupMethod) {
    const split = this.splitHandle(handle);

    const { username, number, collision } = split;

    const csplit = number.split('.');
    const url = `${this.server}/${lookupMethod}/${csplit[0]}/${username}/${
      collision ? collision : ''
    }`;
    return url;
  }

  async performTrustedSearch(url) {
    const data = await axios.get(url).then(x => {
      if (x.data === undefined) {
        throw new Error('error in search');
      }
      return x.data;
    });

    return data;
  }

  /**
   * register a cashAccount via lookup server
   *
   * @param {string} username - ie: jonathan
   * @param {string} bchAddress - ie: bitcoincash:qqqqqqq
   * @param {string} slpAddress - ie: simpleledger:qqqqqqq
   * @returns {obj} hex and txid
   * @memberof CashAccount
   */
  async trustedRegistration(username, bchAddress, slpAddress) {
    const url = `${this.server}/register`;
    const payments = [bchAddress];
    if (slpAddress) {
      payments.push(slpAddress);
    }

    const data = {
      name: username,
      payments
    };

    const resp = await axios.post(url, data).then(x => {
      if (x.data === undefined) {
        throw new Error('error with registration');
      }
      return x.data;
    });

    return resp;
  }

  /**
   * get metadata on cashaccount from your node
   *
   * @param {string} handle - ie: jonathan#100
   * @returns {object}
   * @memberof CashAccounts
   */
  async trustlessLookup(handle) {
    const url = await this.buildSearchUrl(handle, 'lookup');
    const data = await this.performTrustedSearch(url);

    const { results } = data;

    // first result
    const tx = await this.bchNode.decodeRawTransaction(results[0].transaction);

    const raw = await this.bchNode.getRawTransaction(tx.txid, 1);

    const { blockhash, txid } = raw;
    const block = await this.bchNode.getBlock(blockhash);

    const { height } = block;

    const opreturn = tx.vout.find(x => x.scriptPubKey.type === 'nulldata')
      .scriptPubKey.asm;

    let number = this.calculateNumber(height);
    const emoji = this.calculateEmoji(txid, blockhash);
    const payment = await this.parsePaymentInfo(opreturn);
    const collision = this.calculateCollisionHash(blockhash, txid);
    const name = await this.parseName(opreturn);

    const object = {
      identifier: `${name}#${number}`,
      information: {
        emoji: emoji,
        name: name,
        number: number,
        collision: { hash: collision, count: 0, length: 0 },
        payment: payment
      }
    };
    return object;
  }

  /**
   * get metadata on cashaccount
   *
   * @param {string} handle - ie: jonathan#100, or with collision ectest#1106.9871360083
   * @returns {object}
   * @memberof CashAccounts
   */
  async trustedLookup(handle) {
    const url = await this.buildSearchUrl(handle, 'account');

    const data = await axios.get(url).then(x => {
      return x.data;
    });

    return data;
  }

  /**
   * get inclusion proofs on cashaccounts
   *
   * @param {string} handle - ie: jonathan#100
   * @returns {object}
   * @memberof CashAccounts
   */
  async getBatchResults(handle) {
    const url = await this.buildSearchUrl(handle, 'lookup');

    const data = await axios.get(url).then(x => {
      return x.data;
    });

    return data;
  }

  /**
   * returns multiple results
   *
   * @param {string} handle
   * @memberof CashAccounts
   */
  async trustedSearch(handle) {
    const results = await this.trustedBitdbLookup(handle);
    let data = results.c;
    let array = [];

    for (const each of data) {
      let item = await this.parseBitdbObject(each);
      item.txid = each.transactionhash;
      array.push(item);
    }
    return array;
  }

  async parseBitdbObject(obj) {
    let { opreturn, blockhash, blockheight, name, transactionhash } = obj;
    // split[0] // OPRETURN
    // split[1] // protocol spec
    // split[2] // username
    // split[3] // first 2 chars = type, followed by BCH pubkey
    // split[4] // first 2 chars = type, followed by Token pubkey

    let number = this.calculateNumber(blockheight);
    const emoji = this.calculateEmoji(transactionhash, blockhash);

    const payment = await this.parsePaymentInfo(opreturn);
    const collision = this.calculateCollisionHash(blockhash, transactionhash);

    const object = {
      identifier: `${name}#${number}`,
      information: {
        emoji: emoji,
        name: name,
        number: number,
        collision: { hash: collision, count: 0, length: 0 },
        payment: payment
      }
    };
    return object;
  }

  /**
   * Parse cashaccount payment info
   *
   * @param {string} opreturn
   * @returns {object} match the output of cashaccount lookup server
   * @memberof CashAccount
   */
  async parsePaymentInfo(opreturn) {
    const split = opreturn.split(' ');
    const payment = [];

    const bchPayment = this.determinePayment(split[3]);
    payment.push(bchPayment);
    if (split.length >= 5) {
      const tokenPayment = this.determinePayment(split[4]);
      tokenPayment.address = bchaddr.toSlpAddress(tokenPayment.address);
      payment.push(tokenPayment);
    }
    return payment;
  }

  /**
   * Parse cashaccount name
   *
   * @param {string} opreturn
   * @returns {object} get name from registration opreturn
   * @memberof CashAccount
   */
  async parseName(opreturn) {
    const split = opreturn.split(' ');
    const name = Buffer.from(split[2], 'hex');
    let string = name.toString('ascii');
    return string;
  }

  /**
   * get address(es) by handle
   *
   * @param {string} handle - ie: jonathan#100, or with collision ectest#1106.9871360083
   * @returns {object} payment information
   * @memberof CashAccounts
   */
  async getPaymentInfo(handle) {
    let account = await this.trustedLookup(handle);

    const {
      information: { payment }
    } = account;

    return payment;
  }

  /**
   * get BCH address from cashaccount
   *
   * @param {string} handle - ie: jonathan#100, or with collision ectest#1106.9871360083
   * @returns {object} payment type and address
   * @memberof CashAccounts
   */
  async getBCHAddress(handle) {
    const payment = await this.getPaymentInfo(handle);
    return payment[0];
  }

  /**
   * get token address from cashaccount
   *
   * @param {string} handle - ie: jonathan#100, or with collision ectest#1106.9871360083
   * @returns {object} token address
   * @memberof CashAccounts
   */
  async getslpAddress(handle) {
    const payment = await this.getPaymentInfo(handle);

    if (payment.length < 2) {
      return {
        warning: 'This account does not have a token address registered.'
      };
    } else {
      return payment[1];
    }
  }

  /**
   * Determine Payment info
   *
   * @param {string} string chunk  of op return containing payment info
   * @returns {object} - { type: 'p2psh', address: 'bitcoincash:qq' }
   * @memberof CashAccount
   */
  determinePayment(string) {
    let type;
    const identifier = string.substring(0, 2);
    switch (identifier) {
      case '01':
        type = 'Key Hash';
        break;
      case '02':
        type = 'Script Hash';
        break;
      case '03':
        type = 'Payment Code';
        break;
      case '04':
        type = 'Stealth Keys';
        break;
      case '81':
        type = 'Key Hash';
        break;
      case '82':
        type = 'Script Hash';
        break;
      case '83':
        type = 'Payment Code';
        break;
      case '84':
        type = 'Stealth Keys';
        break;
    }

    const hash = Buffer.from(string.substring(2), 'hex');
    const address = this.determineAddress(identifier, hash);

    return {
      type: type,
      address: address
    };
  }

  /**
   * returns the emoji
   *
   * @param {string} registrationTxid
   * @param {string} blockhash
   * @returns emoji
   * @memberof CashAccounts
   */
  calculateEmoji(registrationTxid, blockhash) {
    blockhash = Buffer.from(blockhash, 'hex');
    registrationTxid = Buffer.from(registrationTxid, 'hex');

    const concat = Buffer.concat([blockhash, registrationTxid]);
    const hash = crypto
      .createHash('sha256')
      .update(concat)
      .digest('hex');
    const last = hash.slice(-8);

    const decimalNotation = parseInt(last, 16);
    const modulus = decimalNotation % 100;
    return EmojiList[modulus];
  }

  /**
   * get address from opreturn hash
   *
   * @param {string} identifier
   * @param {string} hash
   * @returns {string} address - bitcoincash:qqasdf or simpleledger:qq
   * @memberof CashAccounts
   */
  determineAddress(identifier, hash) {
    let address;

    switch (identifier) {
      case '01':
        address = cashaddr.encode(
          'bitcoincash',
          'P2PKH',
          Uint8Array.from(hash)
        );

        break;

      case '02':
        address = cashaddr.encode('bitcoincash', 'P2SH', Uint8Array.from(hash));
        break;

      case '03':
        address = bitcoincashjs.encoding.Base58Check.encode(
          Buffer.concat([Buffer.from('47', 'hex'), hash])
        );
        break;

      // token registrations
      case '81':
        address = cashaddr.encode(
          'bitcoincash',
          'P2PKH',
          Uint8Array.from(hash)
        );
        address = this.toSlpAddress(address);
        break;

      case '82':
        address = cashaddr.encode('bitcoincash', 'P2SH', Uint8Array.from(hash));
        address = this.toSlpAddress(address);
        break;

      case '83':
        address = bitcoincashjs.encoding.Base58Check.encode(
          Buffer.concat([Buffer.from('47', 'hex'), hash])
        );
        address = this.toSlpAddress(address);
        break;
    }
    return address;
  }

  /**
   * search bitdb for cashaccount
   *
   * @param {string} handle - ie: jonathan#100, or with collision ectest#1106.9871360083
   * @returns {object} - array of confirmed and unconfirmed transactions
   * @memberof CashAccounts
   */
  async trustedBitdbLookup(handle) {
    const split = this.splitHandle(handle);

    const { username, number, collision } = split;

    let accountNumber = parseInt(number);

    const height = genesisBlock + accountNumber;

    const query = {
      v: 3,
      q: {
        find: {
          'out.h1': '01010101',
          'blk.i': height,
          'out.s2': { $regex: `^${username}`, $options: 'i' }
        },
        limit: 22
      },
      r: {
        f:
          '[ .[] | { blockheight: .blk.i?, blockhash: .blk.h?, transactionhash: .tx.h?, opreturn: .out[0].str, name: .out[0].s2, data: .out[0].h3} ]'
      }
    };
    const urlString = this.bufferString(query);
    const response = await axios.get(`https://bitdb.bch.sx/q/${urlString}`);

    if (response.data === undefined) {
      throw new Error('error bitdb lookup');
    }

    // .catch(e => {
    //   console.error('err in getNumberofTxs', e);
    // });

    return response.data;
  }

  /**
   * find cashaccount by Txid
   *
   * @param {string} txid - registration transaction id
   * @returns {object} - confirmed registration transaction
   * @memberof CashAccounts
   */
  async accountLookupViaTxid(txid) {
    const query = {
      v: 3,
      q: {
        find: {
          'tx.h': txid
        },
        limit: 1
      },
      r: {
        f:
          '[ .[] | { blockheight: .blk.i?, blockhash: .blk.h?, transactionhash: .tx.h?, opreturn: .out[0].str, name: .out[0].s2, data: .out[0].h3} ]'
      }
    };
    const urlString = this.bufferString(query);
    const response = await axios.get(`https://bitdb.bch.sx/q/${urlString}`);

    if (response.data === undefined) {
      throw new Error('error with account lookup');
    }

    // .catch(e => {
    //   console.error('err in getNumberofTxs', e);
    // });
    return response.data.c[0];
  }

  /**
   * find pending registration by Txid
   *
   * @param {string} txid - registration transaction id
   * @returns {object} - confirmed registration transaction
   * @memberof CashAccounts
   */
  async registrationLookupViaTxid(txid) {
    const query = {
      v: 3,
      q: {
        find: {
          'tx.h': txid
        },
        limit: 1
      },
      r: {
        f:
          '[ .[] | { blockheight: .blk.i?, blockhash: .blk.h?, transactionhash: .tx.h?, opreturn: .out[0].str, name: .out[0].s2, data: .out[0].h3} ]'
      }
    };
    const urlString = this.bufferString(query);
    const response = await axios.get(`https://bitdb.bch.sx/q/${urlString}`);

    if (response.data === undefined) {
      throw new Error('error with registration lookup');
    }
    // .catch(e => {
    //   console.error('err in getNumberofTxs', e);
    // });

    return response.data.u[0];
  }

  /**
   * construct object for the opreturn script
   *
   * @param {string} username
   * @param {string} bchAddress
   * @param {string} [slpAddress] - optional
   * @returns {object}
   * @memberof CashAccounts
   */
  createRegistrationObj(username, bchAddress, slpAddress = '') {
    const bchHash = this.getHashFromAddress(bchAddress);
    let slpHash;
    if (slpAddress) {
      slpHash = this.getHashFromAddress(slpAddress);
    }
    return {
      username: username,
      bchHash,
      slpHash
    };
  }

  /**
   * broadcast cashaccount registration with your own node
   *
   * @param {string} username
   * @param {string} bchAddress
   * @param {string} slpAddress
   * @returns {string} txid - registration transaction hash
   * @memberof CashAccounts
   */
  async trustlessRegistration(username, bchAddress, slpAddress) {
    let txString = await this.generateRawTx(username, bchAddress, slpAddress);
    let hex = await bchNode.signRawTransaction(txString);
    let txid = await bchNode.sendRawTransaction(hex.hex);
    return txid;
  }

  /**
   * find cash accounts associated with an address
   *
   * @param {string} address - ie: bitcoincash:qqqqqqq
   * @returns {obj} hex and txid
   * @memberof CashAccount
   */
  async reverseLookup(address) {
    if (this.server === 'https://api.cashaccount.info') {
      return {
        status: 'The default lookup server does not support this endpoint'
      };
    }
    const url = `${this.server}/reverselookup/${address}`;

    const resp = await axios.get(url).then(x => {
      if (x.data === undefined) {
        throw new Error('error with reverseLookup');
      }
      return x.data;
    });

    return resp;
  }

  /**
   * creates the raw transaction to be broadcast later
   *
   * @param {string} username
   * @param {string} bchAddress
   * @param {string} slpAddress
   * @returns {string} raw transaction of registration
   * @memberof CashAccounts
   */
  async generateRawTx(username, bchAddress, slpAddress) {
    let registrationObj = this.createRegistrationObj(
      username,
      bchAddress,
      slpAddress
    );
    let script = this.buildScript(registrationObj);

    let unspent = await this.bchNode.listUnspent(1);
    if (unspent === undefined || unspent.length === 0) {
      unspent = await this.bchNode.listUnspent(0);
    }
    if (unspent === undefined || unspent.length === 0) {
      return { status: 'no UTXOs available' };
    }

    const changeAddr = await this.bchNode.getRawChangeAddress();

    let tx = new bch.Transaction().from(unspent).feePerKb(1002);
    tx.addOutput(new bch.Transaction.Output({ script: script, satoshis: 0 }));
    tx.change(changeAddr);

    return tx.toString();
  }

  /**
   * creates the raw op return script
   *
   * @param {string} username
   * @param {string} bchAddress
   * @param {string} slpAddress
   * @returns {string} registration script
   * @memberof CashAccounts
   */
  async createRawOpReturn(username, bchAddress, slpAddress) {
    let registrationObj = this.createRegistrationObj(
      username,
      bchAddress,
      slpAddress
    );
    let script = this.buildScript(registrationObj);
    return script.toString();
  }

  /**
   *
    build opreturn script
   *
   * @param {oject} registrationObj
   * @returns
   * @memberof CashAccounts
   */
  buildScript(registrationObj) {
    const { username, bchHash, slpHash } = registrationObj;

    let bch_map = {
      p2pkh: '01',
      p2sh: '02',
      p2pc: '03',
      p2sk: '04'
    };
    let token_map = {
      p2pkh: '81',
      p2sh: '82',
      p2pc: '83',
      p2sk: '84'
    };

    const s = new bch.Script();
    s.add(bch.Opcode.OP_RETURN);
    s.add(Buffer.from('01010101', 'hex'));
    s.add(Buffer.from(username, 'utf8'));

    for (let [key, value] of Object.entries(bchHash)) {
      s.add(Buffer.from(bch_map[key] + value, 'hex'));
    }
    if (slpHash !== undefined) {
      for (let [key, value] of Object.entries(slpHash)) {
        s.add(Buffer.from(token_map[key] + value, 'hex'));
      }
    }
    return s;
  }

  /**
   * get hash from address for registration protocol
   *
   * @param {string} address - ex: bitcoincash:qq
   * @returns {object} - { p2pkh:'asdfhash'}
   * @memberof CashAccounts
   */
  getHashFromAddress(address) {
    if (typeof address === 'string') {
      address = [address];
    }

    const id = {};

    for (let item of address) {
      if (item.startsWith('simpleledger:')) {
        item = bchaddr.toCashAddress(item);
      }

      try {
        //p2pkh/p2sh
        const type = bchaddr.detectAddressType(item);
        id[type] = Buffer.from(
          cashaddr.decode(bchaddr.toCashAddress(item)).hash
        ).toString('hex');
        continue;
      } catch (err) {
        console.log('err in p2psh', err);
      }

      try {
        //bip47 payment code
        const b58 = base58check.decode(item);
        if (b58.prefix.toString('hex') === '47' && b58.data.length == 80) {
          id['p2pc'] = b58.data.toString('hex');
          continue;
        }
      } catch (err) {
        console.log('err in bip47', err);
      }

      // failed to detect an address
      return false;
    }

    return id;
  }

  /**
   * calculate collision hash
   *
   * @param {string} blockhash - registration blockheight
   * @param {string} txid - transaction hash
   * @returns {string} -
   * @memberof CashAccounts
   */
  calculateCollisionHash(blockhash, txid) {
    blockhash = Buffer.from(blockhash, 'hex');
    txid = Buffer.from(txid, 'hex');

    // Step 1: Concatenate the block hash with the transaction hash
    const concat = Buffer.concat([blockhash, txid]);

    // Step 2: Hash the results of the concatenation with sha256
    const hash = crypto
      .createHash('sha256')
      .update(concat)
      .digest('hex');

    // Step 3: Take the first four bytes and discard the rest
    const firstFour = hash.substring(0, 8);

    // Step 4: Convert to decimal notation and store as a string
    const decimalNotation = parseInt(firstFour, 16);

    // Step 5: Reverse the the string so the last number is first
    const reverse = decimalNotation
      .toString()
      .split('')
      .reverse()
      .join('');

    // Step 6: Right pad the string with zeroes up to a string length of 10.
    const padded = this.rightPadWithZeros(reverse);

    return padded;
  }

  rightPadWithZeros(string) {
    let count = string.length;
    let diff = 10 - parseInt(count);
    if (diff >= 0) {
      let val = 10 ** diff;
      val = val.toString().substring(1);
      string += val;
    }

    return string;
  }

  /**
   * calculate cashaccount number
   *
   * @param {int} blockheight - registration blockheight
   * @returns {string} - 123
   * @memberof CashAccounts
   */
  calculateNumber(blockheight) {
    blockheight = parseInt(blockheight);
    const num = blockheight - genesisBlock;
    return num.toString();
  }

  /**
   * check if cash account
   *
   * @param {string} string - ie: jonathan#100
   * @returns {boolean}
   * @memberof CashAccount
   */
  isCashAccount(string) {
    const cashAccountRegex = /^([a-zA-Z0-9_]+)(#([0-9]+)(([0-9]+))).([0-9]+)?$/i;

    const split = this.splitHandle(string);
    const { username, number } = split;

    if (isNaN(number)) {
      return false;
    }

    if (username === undefined) {
      return false;
    }

    if (number === undefined) {
      return false;
    }

    return cashAccountRegex.test(string);
  }

  /**
   * split/parse a cashaccount handle
   *
   * @param {string} handle - ie: jonathan#100, or with collision ectest#1106.9871360083
   * @returns {object} {username: 'jonathan', number: '100', collision: false}
   * @memberof CashAccounts
   */
  splitHandle(handle) {
    let collision;

    if (handle.includes('.')) {
      collision = handle.split('.');
      handle = collision[0].split('#');
    } else {
      handle = handle.split('#');
    }
    return {
      username: handle[0],
      number: handle[1],
      collision: collision !== undefined && collision[1]
    };
  }

  /**
   * Buffer string for bitdb
   *
   * @param {object} query
   * @returns
   * @memberof CashAccount
   */
  bufferString(query) {
    return Buffer.from(JSON.stringify(query)).toString('base64');
  }

  /**
   * convert to simpleledger format
   *
   * @param {string} addr
   * @returns {string} simpeledger:qqajsdlkf
   * @memberof CashAccounts
   */
  toSlpAddress(addr) {
    return bchaddr.toSlpAddress(addr);
  }
}

module.exports = CashAccounts;
