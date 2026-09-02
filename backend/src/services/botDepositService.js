/**
 * Compatibility wrapper — Telegram bot and Mini App share depositVerificationService.
 */
const {
  verifyAndCreditDeposit,
  getDepositRejectionMessage,
  formatDepositSuccessMessage,
} = require('./depositVerificationService');

async function verifyAndApproveDeposit(params = {}) {
  return verifyAndCreditDeposit({
    userId: params.userId,
    provider: params.provider || params.paymentMethod,
    reference: params.reference || params.transactionId || params.ref,
    amount: params.amount ?? params.submittedAmount,
    receivingNumber: params.receivingNumber || params.number,
    source: params.source || 'bot',
  });
}

module.exports = {
  verifyAndApproveDeposit,
  verifyAndCreditDeposit,
  getDepositRejectionMessage,
  formatDepositSuccessMessage,
};
