const EmojiList = require('./emoji_names.json');
const crypto = require('crypto');
const axios = require('axios');
const cashaddr = require('cashaddrjs');
const base58check = require('base58check');
const bitcoincashjs = require('bitcoincashjs-lib');
const bch = require('bitcore-lib-cash');
const bchaddr = require('bchaddrjs-slp');

const genesisBlock = 563720 - 100;

class CashAccounts {
  /**
   * constructor
   *
   * @param {string} server - if you have your own lookup server
   */

  constructor(server) {
    this.server = server || 'https://api.cashaccount.info';
  }

  /**
   * get the address for user's handle
   *
   * @param {string} string - ie: jonathan#100
   * @returns {obj}
   * @memberof CashAccount
   */
  async getAddressByCashAccount(string) {
    const split = string.split('#');

    const name = split[0];

    const number = split[1];
    const csplit = number.split('.');
    const url = `${this.server}/account/${csplit[0]}/${name}/${
      csplit.length === 2 ? csplit[1] : ''
    }`;

    const data = await axios
      .get(url)
      .then(x => {
        return x.data;
      })
      .catch(err => {
        console.log('error in getAddressByCashAccount', err.response);
      });

    return data;
  }

  /**
   * register a cashAccount via lookup server
   *
   * @param {string} username - ie: jonathan
   * @param {string} bchAddress - ie: bitcoincash:qqqqqqq
   * @param {string} tokenAddress - ie: simpleledger:qqqqqqq
   * @returns {obj} hex and txid
   * @memberof CashAccount
   */
  async registerCashAccount(username, bchAddress, tokenAddress) {
    const url = `${this.server}/register`;
    const payments = [bchAddress];
    if (tokenAddress) {
      payments.push(tokenAddress);
    }

    const data = {
      name: username,
      payments
    };

    const resp = await axios
      .post(url, data)
      .then(x => {
        return x.data;
      })
      .catch(err => {
        console.log('error in registerCashAccount', err);
      });

    return resp;
  }

  /**
   * get metadata on cashaccount
   *
   * @param {string} handle - ie: jonathan#100
   * @returns {object}
   * @memberof CashAccounts
   */
  async getAccountInfo(handle) {
    const split = handle.split('#');
    const username = split[0];
    const number = split[1];

    let data = await this.accountLookupViaBitDB(username, number);

    if (!data.c.length && !data.u.length) {
      return {};
    }
    // take first confirmed
    data = data.c[0];

    const { opreturn, transactionhash, blockhash } = data;
    const payment = await this.parsePaymentInfo(opreturn);

    const emoji = this.calculateEmoji(transactionhash, blockhash);

    const object = {
      identifier: `${username}#${number}`,
      information: {
        emoji: emoji,
        name: username,
        number: number,
        collision: { hash: '', count: 0, length: 0 },
        payment: payment
      }
    };
    return object;
  }

  async parseBitdbObject(obj) {
    let { opreturn, blockhash, blockheight, name, transactionhash } = obj;
    // split[0] // OPRETURN
    // split[1] // protocol spec
    // split[2] // username
    // split[3] // first 2 chars = type, followed by BCH pubkey
    // split[4] // first 2 chars = type, followed by Token pubkey

    const split = opreturn.split(' ');
    let number = this.calculateNumber(blockheight);
    const emoji = this.calculateEmoji(transactionhash, blockhash);
    const payment = await this.parsePaymentInfo(opreturn);

    const object = {
      identifier: `${name}#${number}`,
      information: {
        emoji: emoji,
        name: name,
        number: number,
        collision: { hash: '', count: 0, length: 0 },
        payment: payment
      }
    };
    return object;
  }
  /**
   * Parse cashaccount OPRETURN
   *
   * @
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
        address = new bch.Address(
          hash,
          'livenet',
          'pubkeyhash'
        ).toCashAddress();
        break;

      case '02':
        address = new bch.Address(
          hash,
          'livenet',
          'scripthash'
        ).toCashAddress();
        break;

      case '03':
        address = bitcoincashjs.encoding.Base58Check.encode(
          Buffer.concat([Buffer.from('47', 'hex'), hash])
        );
        break;
      case '81':
        address = new bch.Address(
          hash,
          'livenet',
          'pubkeyhash'
        ).toCashAddress();
        break;

      case '82':
        address = new bch.Address(
          hash,
          'livenet',
          'scripthash'
        ).toCashAddress();
        break;

      case '83':
        address = bitcoincashjs.encoding.Base58Check.encode(
          Buffer.concat([Buffer.from('47', 'hex'), hash])
        );
        break;
    }
    return address;
  }

  /**
   * search bitdb for cashaccount
   *
   * @param {string} username
   * @param {string} number
   * @returns {object} - array of confirmed and unconfirmed transactions
   * @memberof CashAccounts
   */
  async accountLookupViaBitDB(username, number) {
    number = parseInt(number);
    const height = genesisBlock + number;

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
    const response = await axios
      .get(`https://bitdb.bch.sx/q/${urlString}`)
      .catch(e => {
        console.error('err in getNumberofTxs', e);
      });

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
    const response = await axios
      .get(`https://bitdb.bch.sx/q/${urlString}`)
      .catch(e => {
        console.error('err in getNumberofTxs', e);
      });

    return response.data.c[0];
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
   * build opreturn script
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

    return cashAccountRegex.test(string);
  }

  /**
   * split/parse a cashaccount handle
   *
   * @param {string} handle - ie: jonathan#100
   * @returns {object} {username: 'jonathan', number: '100'}
   * @memberof CashAccounts
   */
  splitHandle(handle) {
    handle = handle.split('#');
    return {
      username: split[0],
      number: split[1]
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

let container = new CashAccounts();
module.exports = container;
