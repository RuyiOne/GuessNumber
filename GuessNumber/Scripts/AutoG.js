class DQN {
    constructor(stateSize, actionSize) {
        this.model = tf.sequential();
        this.model.add(tf.layers.dense({ inputShape: [stateSize], units: 128, activation: 'relu' }));
        this.model.add(tf.layers.dense({ units: 128, activation: 'relu' }));
        this.model.add(tf.layers.dense({ units: actionSize }));
        this.model.compile({ optimizer: tf.train.adam(0.0001), loss: 'meanSquaredError' });
    }

    predict(state) {

        return tf.tidy(() => this.model.predict(state));
    }

    async train(states, targets) {
        return this.model.fit(states, targets, { batchSize: 64, epochs: 1 });
    }

    copyWeights(sourceModel) {
        const sourceWeights = sourceModel.model.getWeights();
        this.model.setWeights(sourceWeights);
    }
    async saveWeights(path) {
        await this.model.save(path);
    }
    async loadWeights(path) {
        const loadedModel = await tf.loadLayersModel(path);
        this.model.setWeights(loadedModel.getWeights());
    }
}

class PrioritizedReplayBuffer {
    constructor(bufferSize, alpha = 0.6) {
        this.buffer = [];
        this.priorities = [];
        this.bufferSize = bufferSize;
        this.alpha = alpha;
    }

    add(experience, tdError) {
        const priority = Math.pow(Math.abs(tdError) + 1e-5, this.alpha);
        this.buffer.push(experience);
        this.priorities.push(priority);

        if (this.buffer.length > this.bufferSize) {
            this.buffer.shift();
            this.priorities.shift();
        }
    }

    sample(batchSize, beta = 0.4) {
        const scaledPriorities = this.priorities.map(p => Math.pow(p, beta));
        const sumPriorities = scaledPriorities.reduce((a, b) => a + b, 0);
        const probabilities = scaledPriorities.map(p => p / sumPriorities);

        const indices = [];
        for (let i = 0; i < batchSize; i++) {
            const rand = Math.random();
            let cumProb = 0;
            for (let j = 0; j < probabilities.length; j++) {
                cumProb += probabilities[j];
                if (rand < cumProb) {
                    indices.push(j);
                    break;
                }
            }
        }

        const samples = indices.map(i => this.buffer[i]);
        const weights = indices.map(i => Math.pow(this.buffer.length * probabilities[i], -beta));
        const maxWeight = Math.max(...weights);

        return { samples, indices, weights: weights.map(w => w / maxWeight) };
    }

    updatePriorities(indices, tdErrors) {
        indices.forEach((index, i) => {
            this.priorities[index] = Math.pow(Math.abs(tdErrors[i]) + 1e-5, this.alpha);
        });
    }
}

class NumberGuessingEnvironment {
    constructor() {
        this.secretNumber = null;
        this.possibleNumbers = this.generateUniqueNumbers();
        this.attempts = 0;
    }

    /**
     * Generate all valid 4-digit numbers with unique digits (no zeros).
     */
    generateUniqueNumbers() {
        const numbers = [];
        for (let i = 1000; i <= 9999; i++) {
            const numStr = i.toString();
            if (new Set(numStr).size === 4 && !numStr.includes('0')) {
                numbers.push(numStr);
            }
        }
        return numbers;
    }

    /**
     * Reset the environment with an optional secret number.
     * @param {string} secretNumber A manually set secret number.
     */
    reset(secretNumber = null) {
        if (secretNumber) {
            if (secretNumber.length !== 4 || new Set(secretNumber).size !== 4 || secretNumber.includes('0')) {
                throw new Error("Secret number must be a 4-digit number with unique non-zero digits.");
            }
            this.secretNumber = secretNumber;
        } else {
            const randomIndex = Math.floor(Math.random() * this.possibleNumbers.length);
            this.secretNumber = this.possibleNumbers[randomIndex];
        }

        this.attempts = 0;
        return new Array(3024).fill(1);//[0, 0, 0, 0]; // Initial state representation
    }

    /**
     * Evaluate a guess against the secret number.
     * @param {string} guess A 4-digit string representing the guess.
     * @returns {Object} Feedback on "dead" and "wounded".
     */
    evaluateGuess(guess, secretNum) {
        // Ensure the guess is a valid 4-digit string
        if (typeof guess !== "string" || guess.length !== 4 || !/^\d{4}$/.test(guess)) {
            throw new Error("Guess must be a 4-digit numeric string.");
        }

        // Ensure the secret number is valid
        if (!secretNum || typeof secretNum !== "string" || secretNum.length !== 4) {
            throw new Error("Secret number is not properly initialized.");
        }

        let dead = 0; // Correct digit, correct position
        let wounded = 0; // Correct digit, wrong position

        // Compare the guess with the secret number
        for (let i = 0; i < 4; i++) {
            if (guess[i] === secretNum[i]) {
                dead++;
            } else if (secretNum.includes(guess[i])) {
                wounded++;
            }
        }

        return { dead, wounded };
    }


    /**
     * Perform a step in the environment.
     * @param {number | string} action Either an index in `possibleNumbers` or the guess itself.
     * @returns {Object} Feedback, reward, done status, and next state.
     */
    step(action) {
        this.attempts++;

        // Determine the guess based on the action
        let guess;

        if (typeof action === "number") {
            guess = this.possibleNumbers[action];
            console.log("guess = " + guess);
        } else {
            guess = action;
        }

        // Evaluate the guess
        const feedback = this.evaluateGuess(guess, this.secretNumber);
        const done = feedback.dead === 4;
        const reward = done ? 100 : feedback.dead * 10 + feedback.wounded * 2;
        //console.log("feedback.dead = " + feedback.dead+ " feedback.wounded = " + feedback.wounded);
        // Narrow down possible numbers based on feedback
        if (!done) {
            this.possibleNumbers = this.possibleNumbers.filter(num => {
                let fb = this.evaluateGuess(num, guess);
                return fb.dead === feedback.dead && fb.wounded === feedback.wounded;
            });
        }

        //console.log("reward = "+ reward);
        let s = new Array(3024).fill(0)
        for (let i = 0; i < s.length; i++) {
            if (this.possibleNumbers.includes(i)) {
                //console.log("i ="+i);
                s[i] = 1;
            }
        }

        return {
            feedback,
            reward,
            done,
            next_state: s,
        };
    }
}


class DQNAgent {
    constructor(stateSize, actionSize, params = {}) {
        this.stateSize = stateSize;
        this.actionSize = actionSize;

        this.gamma = params.gamma || 0.09;
        this.epsilon = params.epsilon || 0.9;
        this.epsilonMin = params.epsilonMin || 0.01;
        this.epsilonDecay = params.epsilonDecay || 0.995;

        this.memory = new PrioritizedReplayBuffer(params.bufferSize || 1000);//20000
        this.batchSize = params.batchSize || 64;

        this.qNetwork = new DQN(stateSize, actionSize);
        this.targetNetwork = new DQN(stateSize, actionSize);
        this.targetNetwork.copyWeights(this.qNetwork);
    }

    act(state) {
        let r = Math.random();
        //console.log("actionSize = "+this.actionSize);
        if (r <= this.epsilon) {
            console.log("random = " + r);
            //console.log("action = "+ (r* this.actionSize))
            return Math.floor(r * this.actionSize);
        }

        const stateTensor = tf.tensor2d([state]);
        const qValues = this.qNetwork.predict(stateTensor);
        const action = qValues.argMax(1).dataSync()[0];
        stateTensor.dispose();
        qValues.dispose();
        return action;
    }

    async train() {
        if (this.memory.buffer.length < this.batchSize) return;

        const { samples, indices, weights } = this.memory.sample(this.batchSize);
        const [states, actions, rewards, nextStates, dones] = this.unpackSamples(samples);
        let count = 0;
        //console.log("samples = "+ this.memory.sample(this.batchSize)[0]);
        const targetQValues = await this.computeTargetQValues(nextStates, rewards, dones);
        const currentQValues = await this.computeCurrentQValues(states, actions);

        const tdErrors = targetQValues.sub(currentQValues).abs().arraySync();
        this.memory.updatePriorities(indices, tdErrors);

        await this.qNetwork.train(states, targetQValues);
        this.epsilon = Math.max(this.epsilonMin, this.epsilon * this.epsilonDecay);
    }

    async computeCurrentQValues(states, actions) {
        return tf.tidy(() => {
            const qValues = this.qNetwork.predict(states);
            return qValues.mul(actions).sum(1);
        });
    }

    async computeTargetQValues(nextStates, rewards, dones) {
        const maxQNext = this.targetNetwork.predict(nextStates).max(1);
        return tf.tidy(() => {
            return tf.tensor(rewards).add(
                maxQNext.mul(tf.tensor(dones).mul(-1).add(1)).mul(this.gamma)
            );
        });
    }

    updateTargetNetwork() {
        this.targetNetwork.copyWeights(this.qNetwork);
    }

    unpackSamples(samples) {
        const states = samples.map(sample => sample[0]);
        const actions = samples.map(sample => sample[1]);
        const rewards = samples.map(sample => sample[2]);
        const nextStates = samples.map(sample => sample[3]);
        const dones = samples.map(sample => sample[4]);

        return [states, actions, rewards, nextStates, dones];
    }
}



async function trainDQN(agent, environment, episodes, manualSecret = null) {
    const logs = [];

    for (let episode = 1; episode <= episodes; episode++) {
        // Reset environment and initialize state
        environment.possibleNumbers = environment.generateUniqueNumbers();
        const initialState = environment.reset(manualSecret);
        let state = tf.tensor2d([initialState], [1, stateSize]);// Convert to TensorFlow tensor
        let done = false;
        let totalReward = 0;
        const actionsTaken = [];
        const feedbackLogs = [];


        while (!done) {
            agent.actionSize = environment.possibleNumbers.length;
            const action = agent.act(state.arraySync()[0]); // Convert state to array for action selection
            actionsTaken.push(action);
            const stepResult = environment.step(action); // Interact with environment
            //console.log("PN2 = " + environment.possibleNumbers.length);
            const { reward, done: isDone, next_state } = stepResult;
            const nextState = tf.tensor2d([next_state], [1, stateSize]); // Ensure [1, 4] shape


            // Predict Q-values and calculate TD error
            const currentQ = agent.qNetwork.predict(state).dataSync()[action];
            const nextQ = isDone ? 0 : Math.max(...agent.targetNetwork.predict(nextState).dataSync());
            const tdError = Math.abs(reward + agent.gamma * nextQ - currentQ);

            // Store experience and train the agent
            agent.memory.add([state.arraySync()[0], action, reward, nextState.arraySync()[0], isDone], tdError);
            //console.log("agent.batchSize = "+ agent.batchSize);
            if (agent.memory.buffer.length >= agent.batchSize) {
                await agent.train();
            }

            totalReward += reward;
            state.dispose(); // Dispose old state tensor to free memory
            state = nextState; // Transition to next state
            done = isDone;
        }

        // Update target network and decay epsilon
        agent.updateTargetNetwork();
        agent.epsilon = Math.max(agent.epsilonMin, agent.epsilon * agent.epsilonDecay);

        // Log episode details
        logs.push({
            episode,
            epsilon: agent.epsilon,
            totalReward,
            actionsTaken,
            feedback: feedbackLogs,
        });

        console.log(
            `Episode ${episode}/${episodes} | Reward: ${totalReward}, Epsilon: ${agent.epsilon.toFixed(3)}`
        );
    }

    return logs;
}

// Initialize environment and agent
const stateSize = 3024; // Number of digits in the game
const environment = new NumberGuessingEnvironment();
const environment2 = new NumberGuessingEnvironment();
const possibleNumbers = environment.generateUniqueNumbers();
const actionSize = possibleNumbers.length;
const agent = new DQNAgent(stateSize, actionSize, {
    gamma: 0.09,
    epsilon: 0.1,
    epsilonDecay: 0.995,
    epsilonMin: 0.01,
    bufferSize: 10,
    batchSize: 10,
});//batchSize:64,

// Train the agent
const episodes = 2;
let manualSecret = "9876";
for (let i = 10; i >= 0; i--) {    
    manualSecret = environment.generateUniqueNumbers()[Math.floor(Math.random() * 3024)]; // Optional: use a fixed secret number for debugging
    console.log('manualsecret ' + i + ' = ' + manualSecret);    
    trainDQN(agent, environment, episodes, manualSecret).then(logs => {
        console.log("Training completed.");
        console.table(logs); // Logs for analysis
    });
}
await agent.qNetwork.saveWeights('~/my-dqn-model');
	//< !--manualSecret = "9876"; -->
	//< !--trainDQN(agent, environment, episodes, manualSecret).then(logs => {
 //   -->
 //       < !--console.log("Training completed."); -->
 //       < !--console.table(logs); // Logs for analysis -->
 //   < !-- }); -->