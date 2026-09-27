function validateObservation({ productId, optionId, price, stock }) {
  if (!productId) {
    return {
      valid: false,
      reason: "MISSING_PRODUCT_ID",
    };
  }

  if (!optionId) {
    return {
      valid: false,
      reason: "MISSING_OPTION_ID",
    };
  }

  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
    return {
      valid: false,
      reason: "INVALID_PRICE",
    };
  }

  if (
    typeof stock !== "number" ||
    !Number.isInteger(stock) ||
    stock < 0
  ) {
    return {
      valid: false,
      reason: "INVALID_STOCK",
    };
  }

  return {
    valid: true,
  };
}

module.exports = {
  validateObservation,
};
