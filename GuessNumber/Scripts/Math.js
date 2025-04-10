
evaluateGuess(guess, secret) {
    let dead = 0, wounded = 0;
    let matchedInSecret = new Array(4).fill(false);
    let matchedInGuess = new Array(4).fill(false);

    // Count 'dead' (correct digit and position)
    for (let i = 0; i < 4; i++) {
        if (guess[i] === secret[i]) {
            dead++;
            matchedInSecret[i] = true;
            matchedInGuess[i] = true;
        }
    }

    // Count 'wounded' (correct digit but wrong position)
    for (let i = 0; i < 4; i++) {
        if (!matchedInGuess[i]) {
            for (let j = 0; j < 4; j++) {
                if (!matchedInSecret[j] && guess[i] === secret[j]) {
                    wounded++;
                    matchedInSecret[j] = true;
                    matchedInGuess[i] = true;
                    break;
                }
            }
        }
    }

    return { dead, wounded };
}

	