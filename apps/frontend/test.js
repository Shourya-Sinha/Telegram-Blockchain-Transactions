const { TronWeb } = require("tronweb");

const account = TronWeb.createRandom();

console.log("Address:", account.address);
console.log("Private Key:", account.privateKey);