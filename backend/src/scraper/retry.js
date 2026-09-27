async function withRetry(task, options = {}) {
  const maxAttempts = options.maxAttempts || 3;
  const delayMs = options.delayMs || 2000;

  const attempts = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await task(attempt);

    attempts.push({
      attempt,
      ...result,
    });

    if (result.success) {
      return {
        success: true,
        attempts,
        result,
      };
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) =>
        setTimeout(resolve, delayMs * attempt)
      );
    }
  }

  return {
    success: false,
    attempts,
    result: attempts[attempts.length - 1],
  };
}

module.exports = {
  withRetry,
};
