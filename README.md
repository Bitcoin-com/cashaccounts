# Cash Accounts javascript library

## Human readable account names for Bitcoin Cash

Cashaccounts allow you to use aliases to send Bitcoin Cash and Tokens instead of
having to type out or memorize things like
`bitcoincash:qp3wjpa3tjlj042z2wv7hahsldgwhwy0rq9sywjpyy`. They look like
`Jonathan#100`; The usernamed followed by the number (based on block height
registration).

## Installation

```
  npm i cashaccounts
```

## Usage

The library will default to using the api.cashaccount.info lookup server, but if
you run your own you can pass in the url as the first parameter. Note,
registrations cost some satoshis to broadcast and the funds are subsidied by the
node running the lookup server. This library contains methods for a trusted
setup like the 3rd party cashaccount api, as well as methods for trustless
setups for more advanced users who do only want to rely on the data from their
own node.

```
  const cashAccountClass = require('cashaccounts');
  const cashAccounts = new cashAccountClass(url, nodeCredentials) // both optional
```

The `url` defaults to `https://api.cashaccount.info`. the `nodeCredentials`
object looks like

```
{
  host: 'example.com', // or ip
  username: 'admin',
  password: 'password1',
  port: 1234,
  timeout: 3000
}
```

### Trusted methods

#### cashAccounts.trustedRegistration(username, bchAddress, slpAddress)

#### cashAccounts.trustedLookup(handle) // jonathan#100

returns

```
{
  "identifier": "tokenAware#15874;",
  "information": {
    "emoji": "🐙",
    "name": "tokenAware",
    "number": 15874,
    "collision": {
      "hash": "2091441002",
      "count": 0,
      "length": 0
  },
  "payment": [
      {
        "address": "bitcoincash:qrry6f92p7x3q4np05xhv5krssdw0q0aaq3sq20mh4",
        "type": "Key Hash"
      },
      {
        "address":"simpleledger:qr932wdxkqdavp27y4pthxn7sf0awuwd7y2swnjm5m",
        "type":"Key Hash"
      }
    ]
  }
}
```

#### cashAccounts.TrustedBitdbLookup(handle) // jonathan#100

returns

```
{
  "identifier": "Jonathan#100;",
  "information": {
    "emoji": "☯",
    "name": "Jonathan",
    "number": 100,
    "collision": {
    "hash": "5876958390",
    "count": 0,
    "length": 0
  },
  "payment": [
      {
        "address": "bitcoincash:qr4aadjrpu73d2wxwkxkcrt6gqxgu6a7usxfm96fst",
        "type": "Key Hash"
      }
    ]
  }
}
```

### Trustless methods

WIP

#### cashAccounts.trustlessRegistration(username, bchAddress, slpAddress)

requires your own node via passing in the `nodeCredentials` object.

## References

Official Website [https://www.cashaccount.info](https://www.cashaccount.info/).

Lookup Server
[https://gitlab.com/cash-accounts/lookup-server](https://gitlab.com/cash-accounts/lookup-server).

You can read the full spec
[https://gitlab.com/cash-accounts/specification/blob/master/SPECIFICATION.md](https://gitlab.com/cash-accounts/specification/blob/master/SPECIFICATION.md).
