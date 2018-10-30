'use strict';

//  ---------------------------------------------------------------------------

const Exchange = require ('./base/Exchange');
const { ArgumentsRequired, ExchangeError, OrderNotFound } = require ('./base/errors');

//  ---------------------------------------------------------------------------

module.exports = class kkex extends Exchange {
    describe () {
        return this.deepExtend (super.describe (), {
            'id': 'kkex',
            'name': 'KKEX',
            'countries': [ 'CN', 'US', 'JP' ],
            'version': 'v1',
            'has': {
                'CORS': false,
                'fetchBalance': true,
                'fetchTickers': true,
                'fetchOpenOrders': true,
                'fetchClosedOrders': true,
                'fetchMyTrades': true,
                'fetchOHLCV': true,
                'createMarketOrder': true,
                'fetchOrder': true,
            },
            'timeframes': {
                '1m': '1min',
                '5m': '5min',
                '15m': '15min',
                '30m': '30min',
                '1h': '1hour',
                '8h': '12hour',
                '1d': 'day',
                '1w': '1week',
            },
            'urls': {
                'logo': 'https://user-images.githubusercontent.com/1294454/47401462-2e59f800-d74a-11e8-814f-e4ae17b4968a.jpg',
                'api': {
                    'public': 'https://kkex.com/api/v1',
                    'private': 'https://kkex.com/api/v2',
                },
                'www': 'https://kkex.com',
                'doc': 'https://kkex.com/api_wiki/cn/',
                'fees': 'https://intercom.help/kkex/fee',
            },
            'api': {
                'public': {
                    'get': [
                        'products',
                        'assets',
                        'tickers',
                        'ticker',
                        'depth',
                        'trades',
                        'kline',
                    ],
                },
                'private': {
                    'post': [
                        'trade',
                        'cancel_order',
                        'order_history',
                        'userinfo',
                        'order_info',
                    ],
                },
            },
            'fees': {
                'trading': {
                    'tierBased': false,
                    'percentage': true,
                    'taker': 0.002,
                    'maker': 0.002,
                },
                'funding': {
                    'tierBased': false,
                    'percentage': false,
                    'withdraw': {},
                    'deposit': {},
                },
            },
            'options': {
                'lastNonceTimestamp': 0,
            },
        });
    }

    async fetchMarkets (params = {}) {
        let tickers = await this.publicGetTickers (params);
        tickers = tickers['tickers'];
        let products = await this.publicGetProducts (params);
        products = products['products'];
        let markets = [];
        for (let k = 0; k < tickers.length; k++) {
            let keys = Object.keys (tickers[k]);
            markets.push (keys[0]);
        }
        let result = [];
        for (let i = 0; i < markets.length; i++) {
            let id = markets[i];
            let market = markets[i];
            let baseId = '';
            let quoteId = '';
            let precision = {};
            let limits = {};
            for (let j = 0; j < products.length; j++) {
                let p = products[j];
                if (p['mark_asset'] + p['base_asset'] === market) {
                    quoteId = p['base_asset'];
                    baseId = p['mark_asset'];
                    let price_scale_str = p['price_scale'].toString ();
                    let scale = price_scale_str.length - 1;
                    precision = {
                        'price': scale,
                        'amount': scale,
                    };
                    limits = {
                        'amount': {
                            'min': Math.max (this.safeFloat (p, 'min_bid_size'), this.safeFloat (p, 'min_ask_size')),
                            'max': Math.min (this.safeFloat (p, 'max_bid_size'), this.safeFloat (p, 'max_ask_size')),
                        },
                        'price': {
                            'min': this.safeFloat (p, 'min_price'),
                            'max': this.safeFloat (p, 'max_price'),
                        },
                    };
                    limits['cost'] = {
                        'min': this.safeFloat (p, 'min_bid_amount'),
                        'max': this.safeFloat (p, 'max_bid_amount'),
                    };
                }
            }
            let base = baseId.toUpperCase ();
            let quote = quoteId.toUpperCase ();
            base = this.commonCurrencyCode (base);
            quote = this.commonCurrencyCode (quote);
            let symbol = base + '/' + quote;
            result.push ({
                'id': id,
                'symbol': symbol,
                'base': base,
                'quote': quote,
                'baseId': baseId,
                'quoteId': quoteId,
                'active': true,
                'precision': precision,
                'limits': limits,
                'info': market,
            });
        }
        return result;
    }

    parseTicker (ticker, market = undefined) {
        let timestamp = this.safeInteger (ticker, 'date');
        if (timestamp !== undefined) {
            timestamp *= 1000;
        }
        let symbol = undefined;
        if (market !== undefined) {
            symbol = market['symbol'];
        }
        let last = this.safeFloat (ticker, 'last');
        return {
            'symbol': symbol,
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'high': this.safeFloat (ticker, 'high'),
            'low': this.safeFloat (ticker, 'low'),
            'bid': this.safeFloat (ticker, 'buy'),
            'bidVolume': undefined,
            'ask': this.safeFloat (ticker, 'sell'),
            'askVolume': undefined,
            'vwap': undefined,
            'open': undefined,
            'close': last,
            'last': last,
            'previousClose': undefined,
            'change': undefined,
            'percentage': undefined,
            'average': undefined,
            'baseVolume': this.safeFloat (ticker, 'vol'),
            'quoteVolume': undefined,
            'info': ticker,
        };
    }

    async fetchTicker (symbol, params = {}) {
        await this.loadMarkets ();
        let market = this.markets[symbol];
        let response = await this.publicGetTicker (this.extend ({
            'symbol': market['id'],
        }, params));
        let ticker = this.extend (response['ticker'], this.omit (response, 'ticker'));
        return this.parseTicker (ticker, market);
    }

    async fetchTickers (symbols = undefined, params = {}) {
        await this.loadMarkets ();
        let response = await this.publicGetTickers (params);
        //
        //     {    date:    1540350657,
        //       tickers: [ { ENUBTC: { sell: "0.00000256",
        //                               buy: "0.00000253",
        //                              last: "0.00000253",
        //                               vol: "138686.828804",
        //                              high: "0.00000278",
        //                               low: "0.00000253",
        //                              open: "0.0000027"      } },
        //                  { ENUEOS: { sell: "0.00335",
        //                               buy: "0.002702",
        //                              last: "0.0034",
        //                               vol: "15084.9",
        //                              high: "0.0034",
        //                               low: "0.003189",
        //                              open: "0.003189"  } }           ],
        //        result:    true                                          }
        //
        let tickers = response['tickers'];
        let result = {};
        for (let i = 0; i < tickers.length; i++) {
            let ids = Object.keys (tickers[i]);
            let id = ids[0];
            let market = this.safeValue (this.markets_by_id, id);
            if (market !== undefined) {
                let symbol = market['symbol'];
                let ticker = this.extend (tickers[i][id], this.omit (response, 'tickers'));
                result[symbol] = this.parseTicker (ticker, market);
            }
        }
        return result;
    }

    async fetchOrderBook (symbol, limit = undefined, params = {}) {
        await this.loadMarkets ();
        let response = await this.publicGetDepth (this.extend ({
            'symbol': this.marketId (symbol),
            'size': limit,
        }, params));
        return this.parseOrderBook (response);
    }

    parseTrade (trade, market = undefined) {
        let timestamp = this.safeInteger (trade, 'date_ms');
        let datetime = this.iso8601 (timestamp);
        let price = this.safeFloat (trade, 'price');
        let amount = this.safeFloat (trade, 'amount');
        let symbol = market['symbol'];
        return {
            'timestamp': timestamp,
            'datetime': datetime,
            'symbol': symbol,
            'id': trade['tid'],
            'order': undefined,
            'type': 'limit',
            'side': trade['type'],
            'price': price,
            'amount': amount,
            'fee': undefined,
            'info': trade,
        };
    }

    async fetchTrades (symbol, since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets ();
        let market = this.market (symbol);
        let response = await this.publicGetTrades (this.extend ({
            'symbol': market['id'],
        }, params));
        return this.parseTrades (response, market, since, limit);
    }

    async fetchBalance (params = {}) {
        await this.loadMarkets ();
        let balances = await this.privatePostUserinfo ();
        let result = { 'info': balances['info'] };
        let funds = balances['info']['funds'];
        let assets = Object.keys (funds['free']);
        for (let i = 0; i < assets.length; i++) {
            let currency = assets[i];
            let uppercase = currency.toUpperCase ();
            uppercase = this.commonCurrencyCode (uppercase);
            let account = this.account ();
            account['free'] = parseFloat (funds['free'][currency]);
            account['used'] = parseFloat (funds['freezed'][currency]);
            account['total'] = account['free'] + account['used'];
            result[uppercase] = account;
        }
        return this.parseBalance (result);
    }

    async fetchOrder (id, symbol = undefined, params = {}) {
        if (!symbol) {
            throw new ArgumentsRequired (this.id + ' fetchOrder requires a symbol argument');
        }
        await this.loadMarkets ();
        let market = this.market (symbol);
        let request = {
            'order_id': id,
            'symbol': market['id'],
        };
        let response = await this.privatePostOrderInfo (this.extend (request, params));
        if (response['result']) {
            return this.parseOrder (response['order'], market);
        }
        throw new OrderNotFound (this.id + ' order ' + id + ' not found');
    }

    async fetchOHLCV (symbol, timeframe = '1m', since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets ();
        let market = this.market (symbol);
        if (!limit) {
            limit = 5;
        }
        if (!since) {
            since = this.milliseconds () - 1000 * 60;
        }
        let response = await this.publicGetKline (this.extend ({
            'symbol': market['id'],
            'type': this.timeframes[timeframe],
            'since': since,
            'size': limit,
        }, params));
        return this.parseOHLCVs (response, market, timeframe, since, limit);
    }

    parseOrderStatus (status) {
        const statuses = {
            '-1': 'canceled',
            '0': 'open',
            '1': 'open',
            '2': 'closed',
            '3': 'open',
            '4': 'canceled',
        };
        return this.safeString (statuses, status, status);
    }

    parseOrder (order, market = undefined) {
        let symbol = undefined;
        if (typeof market !== 'undefined')
            symbol = market['symbol'];
        let side = this.safeString (order, 'side');
        if (typeof side === 'undefined') {
            side = this.safeString (order, 'type');
        }
        let timestamp = undefined;
        let iso8601 = undefined;
        let order_id = undefined;
        let amount = undefined;
        let keys = Object.keys (order);
        let status = this.parseOrderStatus (this.safeString (order, 'status'));
        if (this.inArray ('order_id', keys)) {
            order_id = order['order_id'];
        } else if (this.inArray ('id', keys)) {
            order_id = order['id'];
        }
        if (this.inArray ('amount', keys)) {
            amount = this.safeFloat (order, 'amount');
        }
        if (this.inArray ('create_date', keys)) {
            timestamp = order['create_date'];
            iso8601 = this.iso8601 (timestamp);
        }
        let filled = this.safeFloat (order, 'deal_amount');
        let average = this.safeFloat (order, 'avg_price');
        let remaining = amount - filled;
        average = this.safeFloat (order, 'price_avg', average);
        let cost = average * filled;
        return {
            'id': parseInt (order_id),
            'datetime': iso8601,
            'timestamp': timestamp,
            'lastTradeTimestamp': undefined,
            'status': status,
            'symbol': symbol,
            'average': average,
            'type': 'limit',
            'side': side,
            'price': this.safeFloat (order, 'price'),
            'cost': cost,
            'amount': amount,
            'filled': filled,
            'remaining': remaining,
            'fee': undefined,
            'info': order,
        };
    }

    async createOrder (symbol, type, side, amount, price = undefined, params = {}) {
        await this.loadMarkets ();
        let market = this.market (symbol);
        let request = {
            'symbol': market['id'],
        };
        if (type === 'market') {
            // for market buy it requires the amount of quote currency to spend
            if (side === 'buy') {
                if (this.options['createMarketBuyOrderRequiresPrice']) {
                    if (price === undefined) {
                        throw new InvalidOrder (this.id + " createOrder() requires the price argument with market buy orders to calculate total order cost (amount to spend), where cost = amount * price. Supply a price argument to createOrder() call if you want the cost to be calculated for you from price and amount, or, alternatively, add .options['createMarketBuyOrderRequiresPrice'] = false to supply the cost in the amount argument (the exchange-specific behaviour)");
                    } else {
                        amount = amount * price;
                    }
                }
                request['price'] = this.amountToPrecision (symbol, amount);
            } else {
                request['amount'] = this.amountToPrecision (symbol, amount);
            }
            side += '_market';
        } else {
            request['amount'] = this.amountToPrecision (symbol, amount);
            request['price'] = this.priceToPrecision (symbol, price);
        }
        request['type'] = side;
        let response = await this.privatePostTrade (this.extend (request, params));
        let id = this.safeString (response, 'order_id');
        return {
            'id': id,
            'datetime': undefined,
            'timestamp': undefined,
            'lastTradeTimestamp': undefined,
            'status': 'open',
            'symbol': symbol,
            'type': type,
            'side': side,
            'price': price,
            'cost': undefined,
            'amount': amount,
            'filled': undefined,
            'remaining': undefined,
            'trades': undefined,
            'fee': undefined,
            'info': response,
        };
    }

    async cancelOrder (id, symbol = undefined, params = {}) {
        if (symbol === undefined) {
            throw new ArgumentsRequired (this.id + ' cancelOrder requires a symbol argument');
        }
        await this.loadMarkets ();
        let market = this.market (symbol);
        let request = {
            'order_id': id,
            'symbol': market['id'],
        };
        return await this.privatePostCancelOrder (this.extend (request, params));
    }

    async fetchOpenOrders (symbol = undefined, since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets ();
        let market = this.market (symbol);
        if (limit === undefined) {
            limit = 20;
        }
        if (since === undefined) {
            since = this.milliseconds () - 1000 * 60 * 60;
        }
        let response = await this.privatePostOrderHistory (this.extend ({
            'symbol': market['id'],
            'status': 0,
            'page_length': limit,
        }, params));
        let orders = this.parseOrders (response['orders'], market, since, limit);
        return orders;
    }

    async fetchClosedOrders (symbol = undefined, since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets ();
        let market = this.market (symbol);
        if (limit === undefined) {
            limit = 20;
        }
        if (since === undefined) {
            since = this.milliseconds () - 1000 * 60 * 60;
        }
        let response = await this.privatePostOrderHistory (this.extend ({
            'symbol': market['id'],
            'status': 1,
            'page_length': limit,
        }, params));
        return this.parseOrders (response['orders'], market, since, limit);
    }

    nonce () {
        return this.milliseconds ();
    }

    sign (path, api = 'public', method = 'GET', params = {}, headers = undefined, body = undefined) {
        let url = this.urls['api'][api] + '/' + path;
        if (api === 'public') {
            url += '?' + this.urlencode (params);
            headers = { 'Content-Type': 'application/json' };
        } else {
            this.checkRequiredCredentials ();
            let nonce = this.nonce ();
            let signature = this.extend ({ 'nonce': nonce, 'api_key': this.apiKey }, params);
            signature = this.keysort (signature);
            signature['secret_key'] = this.secret;
            signature = this.urlencode (signature);
            signature = this.encode (signature);
            signature = this.hash (signature, 'md5').toUpperCase ();
            body = this.extend ({
                'api_key': this.apiKey,
                'sign': signature,
                'nonce': nonce,
            }, params);
            body = this.urlencode (body);
            headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
        }
        return { 'url': url, 'method': method, 'body': body, 'headers': headers };
    }
};