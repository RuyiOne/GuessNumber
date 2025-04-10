/// <reference path="jquery-1.9.0.min.js" />

class DQN {
    constructor(stateSize, actionSize) {
        this.model = tf.sequential();
        this.model.add(tf.layers.dense({ inputShape: [stateSize], units: 128, activation: 'relu' }));
        this.model.add(tf.layers.dense({ units: 128, activation: 'relu' }));
        this.model.add(tf.layers.dense({ units: actionSize }));
        this.model.compile({ optimizer: tf.train.adam(0.01), loss: 'meanSquaredError' });
    }

    predict(state) {

        return tf.tidy(() => this.model.predict(state));
    }

    async train(states, targets) {
        return this.model.fit(states, targets, { batchSize: 1, epochs: 1 });
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
            console.log('guesslength = ' + guess.length);
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
        } else {
            guess = action;
        }        
        // Evaluate the guess
        const feedback = this.evaluateGuess(guess.toString(), this.secretNumber.toString());//remove tostring
        const done = feedback.dead === 4;
        const reward = done ? 100 : feedback.dead * 10 + feedback.wounded * 2;
        //console.log("feedback.dead = " + feedback.dead+ " feedback.wounded = " + feedback.wounded);
        // Narrow down possible numbers based on feedback
        if (!done) {
            this.possibleNumbers = this.possibleNumbers.filter(num => {
                let fb = this.evaluateGuess(num.toString(), guess.toString());//remove tostring
                return fb.dead === feedback.dead && fb.wounded === feedback.wounded;
            });
        }

        //console.log("reward = "+ reward);
        let s = new Array(3024).fill(0)
        //for (let i = 0; i < s.length; i++) {
        //    if (this.possibleNumbers.includes(i)) {
        //        //console.log("i ="+i);
        //        s[i] = 1;
        //    }
        //}

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
        this.isTraining = false; // Add training lock
    }

    act(state) {
        let r = Math.random();
        //console.log("actionSize = "+this.actionSize);
        if (r <= this.epsilon) {
            //console.log("random = "+ r)            
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
        if (this.memory.buffer.length < this.batchSize || this.isTraining || this.actionSize < 2) return;
        this.isTraining = true;
        console.log("Starting training step");
        try {
            const { samples, indices, weights } = this.memory.sample(this.batchSize);
            const [states, actions, rewards, nextStates, dones] = this.unpackSamples(samples);

            const statesTensor = tf.tensor2d(states, [states.length, this.stateSize]);
            const nextStatesTensor = tf.tensor2d(nextStates, [nextStates.length, this.stateSize]);
            const rewardsTensor = tf.tensor1d(rewards);
            const donesTensor = tf.tensor1d(dones);

            const targetQValuesScalar = await this.computeTargetQValues(nextStatesTensor, rewardsTensor, donesTensor);
            const qValues = this.qNetwork.predict(statesTensor);
            const actionsOneHot = tf.oneHot(tf.tensor1d(actions, 'int32'), this.actionSize);
            const mask = actionsOneHot.cast('float32');
            const targetQValuesFull = qValues.mul(tf.onesLike(mask).sub(mask)).add(
                mask.mul(targetQValuesScalar.expandDims(1))
            );

            const currentQValues = await this.computeCurrentQValues(statesTensor, actions);
            const tdErrors = targetQValuesScalar.sub(currentQValues).abs().arraySync();
            this.lastAvgTDError = tdErrors.length > 0 ? tdErrors.reduce((a, b) => a + b, 0) / tdErrors.length : 0;
            console.log("this.lastAvgTDError = " + this.lastAvgTDError);
            this.memory.updatePriorities(indices, tdErrors);

            await this.qNetwork.train(statesTensor, targetQValuesFull);

            this.epsilon = Math.max(this.epsilonMin, this.epsilon * this.epsilonDecay);

            statesTensor.dispose();
            nextStatesTensor.dispose();
            rewardsTensor.dispose();
            donesTensor.dispose();
            targetQValuesScalar.dispose();
            currentQValues.dispose();
            qValues.dispose();
            actionsOneHot.dispose();
            mask.dispose();
            targetQValuesFull.dispose();
        } finally {
            this.isTraining = false;
        }
    }
    async computeCurrentQValues(states, actions) {
        return tf.tidy(() => {
            const qValues = this.qNetwork.predict(states);
            const actionsOneHot = tf.oneHot(tf.tensor1d(actions, 'int32'), this.actionSize);
            return qValues.mul(actionsOneHot).sum(1);
        });
    }

    async computeTargetQValues(nextStates, rewards, dones) {
        const maxQNext = this.targetNetwork.predict(nextStates).max(1);
        return tf.tidy(() => {
            return rewards.add(  // Use the tensor directly
                maxQNext.mul(dones.mul(-1).add(1)).mul(this.gamma)
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


let chart = null;
let metrics = {
    trainingSteps: [],
    averagePriorities: [],
    averageSampledTDErrors: [],
    epsilons: []
};
let globalTrainingStep = 0; // Continuous counter across all runs
async function trainDQN(agent, environment, episodes, manualSecret = null) {
    const logs = [];
    //let trainingStep = 0;
    for (let episode = 1; episode <= episodes; episode++) {
        environment.possibleNumbers = environment.generateUniqueNumbers();
        const initialState = environment.reset(manualSecret);
        let state = tf.tensor2d([initialState], [1, stateSize]);
        let done = false;
        let totalReward = 0;
        const actionsTaken = [];
        const feedbackLogs = [];

        while (!done) {
            agent.actionSize = environment.possibleNumbers.length;
            const action = agent.act(state.arraySync()[0]);
            actionsTaken.push(action);
            const stepResult = environment.step(action);
            const { reward, done: isDone, next_state } = stepResult;
            const nextState = tf.tensor2d([next_state], [1, stateSize]);

            const currentQ = agent.qNetwork.predict(state).dataSync()[action];
            const nextQ = isDone ? 0 : Math.max(...agent.targetNetwork.predict(nextState).dataSync());
            const tdError = Math.abs(reward + agent.gamma * nextQ - currentQ);

            agent.memory.add([state.arraySync()[0], action, reward, nextState.arraySync()[0], isDone], tdError);

            totalReward += reward;
            state.dispose();
            state = nextState;
            done = isDone;

            if (agent.memory.buffer.length >= agent.batchSize && !done) {
                await agent.train();
                globalTrainingStep++;
                console.log("trsteps = " + globalTrainingStep);
                console.log("agent.lastAvgTDError = " + agent.lastAvgTDError);
                const avgPriority = agent.memory.priorities.length > 0 ?
                    agent.memory.priorities.reduce((a, b) => a + b, 0) / agent.memory.priorities.length : 0;
                metrics.trainingSteps.push((globalTrainingStep));
                metrics.averagePriorities.push(avgPriority);
                metrics.averageSampledTDErrors.push(agent.lastAvgTDError !== undefined ? agent.lastAvgTDError : 0);
                metrics.epsilons.push(agent.epsilon);
            }
        }

        agent.updateTargetNetwork();
        agent.epsilon = Math.max(agent.epsilonMin, agent.epsilon * agent.epsilonDecay);

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
    logMetrics(metrics);
    
    
    return logs;
}
function logMetrics(metrics) {
    if (chart) {
        chart.destroy();
        chart = null;
        console.log("destroy last chart");
    }
    console.log('Training Step | Average Priority | Average Sampled TD Error | Epsilon');
    metrics.trainingSteps.forEach((step, i) => {
        const avgPriority = metrics.averagePriorities[i] ?? 0;
        const avgTDError = metrics.averageSampledTDErrors[i] ?? 0;
        const epsilon = metrics.epsilons[i] ?? 0;
        console.log(`Step ${step}: avgPriority=${avgPriority}, avgTDError=${avgTDError}, epsilon=${epsilon}`);
        console.log(`${step} | ${avgPriority.toFixed(4)} | ${avgTDError.toFixed(4)} | ${epsilon.toFixed(4)}`);
    });
    const ctx = document.getElementById('metricsChart').getContext('2d');
    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: metrics.trainingSteps,
            datasets: [
                //{
                //    label: 'Average Priority',
                //    data: metrics.averagePriorities,
                //    borderColor: 'red',
                //    fill: false
                //},
                {
                    label: 'Average Sampled TD Error',
                    data: metrics.averageSampledTDErrors,
                    borderColor: 'blue',
                    fill: false
                },
                //{
                //    label: 'Epsilon',
                //    data: metrics.epsilons,
                //    borderColor: 'green',
                //    fill: false
                //}
            ]
        },
        options: {
            scales: {
                x: { title: { display: true, text: 'Training Step' } },
                y: { title: { display: true, text: 'Value' } }
            }
        }
    });

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
    epsilonDecay: 0.95,
    epsilonMin: 0.01,
    bufferSize:100,
    batchSize: 5,
});//batchSize:64,

// Train the agent
const episodes = 1;
let manualSecret = "9876";
for (let i = 500; i >= 0; i--) {
    manualSecret = environment.generateUniqueNumbers()[Math.floor(Math.random() * 3024)]; // Optional: use a fixed secret number for debugging
    //console.log('manualsecret ' + i + ' = ' + manualSecret);
    trainDQN(agent, environment, episodes, manualSecret).then(logs => {
        console.log("Training completed.");
        console.table(logs); // Logs for analysis
    });
}


//await agent.qNetwork.saveWeights('~/my-dqn-model');
	//< !--manualSecret = "9876"; -->
	//< !--trainDQN(agent, environment, episodes, manualSecret).then(logs => {
 //   -->
 //       < !--console.log("Training completed."); -->
 //       < !--console.table(logs); // Logs for analysis -->
 //   < !-- }); -->

PlayerOne = new Object();
PlayerTwo = new Object();
var isComputer = false;
var computerSecretNum;
var agentdqn = true;
var aiGuesses = [];
var num = "";
var store = "";
var comguess = "";
var count = 0;
var counter;
var dead = 0;
var k = 1;
var p = "";
var q = "";
var number;
var wounded = 0;
var table;
var x;
var xCount, yCount;
var y;
var z;
var initiator;
var tcount = 0;
var isRestart = false;
var initUserinfo = '';
var fourdead = false;


ChannelName = new Object();
UserId = new Object();

function SinglePlayer() {
    PlayerTwo.name = "Computer";
    computerSecretNum = makeAIGuess();
    //console.log("csn = " + computerSecretNum);
    //console.log("Human-Player = " + PlayerOne.number);
    //var firstguess = makeAIGuess();
    //console.log("fguess = " + firstguess);
    //var f = evaluateGuess(firstguess.toString(), computerSecretNum.toString());
    //filterAIPossibleNumbers(f, firstguess);
    //console.log("dead = "+ f.dead + "; wounded = "+ f.wounded);
    //store = firstguess;
    //dead = f.dead;
    //wounded = f.wounded;
    //console.log(f);

    //insCell();
    isComputer = true;
    initiator = true;
    initUserinfo = $('#userinfo').html();    
    $('#userinfo').find('#avail').remove('#avail');
    $('#userinfo').find('.userdata').remove();
    $('#userinfo').html('');
    $('#userinfo').append('<h2 class= "sub-header">Profile</h2>');
    var xx = '<div class="table-responsive" style="width:300px;"><table class="table table-striped">';
    xx = xx + '<tr><td><ul><img src="pix/you.jpg" style="height:75px; width 75px;"></ul></td><table style="margin-top: -85px;margin-left: 150px;"><tr><td>' + PlayerOne.name + '</td></tr><tr><td>6 Wins</td></tr></table>';
    xx = xx + '<table><tr><td><ul style="height:25px; width 75px; text-align:center; margin-top:50px; margin-left:75px;">Vs.</ul></td></tr></table>';
    xx = xx + '<tr><td><ul><img src="pix/mimi.jpg" style="height:75px; width 75px; margin-top:0px; margin-left:5px;"></ul></td><table style="margin-top: -75px;margin-left: 150px;"><tr><td>' + PlayerTwo.name + '</td></tr><tr><td>6 Wins</td></tr></table>';
    //x = x + '<tr><td></td><td></td></tr>';
    xx = xx + '</table></div>';
    $('#userinfo').append(xx);
    //$('#start').removeAttr('hidden');
    if (initiator) {
        
        $('.nmb').removeAttr('disabled');
        $('#details').text('Your turn.');
    }
    else {
        $('#details').text(PlayerTwo.name + "'s turn.");
    }
    $('#numb').val('');
    //$('#userinfo').append(PlayerOne.name + ' vs ' + PlayerTwo.name); 
    setTimeout(function () {
        $('#mybody').fadeOut(2000);
        $('#mybody').attr('style', 'display:none;')

        $('#console').attr('style', 'display:block; margin-top:0px;');
        var xx = '<tr><th align="center">';
        xx = xx + PlayerOne.name.toString();
        xx = xx + '</th><th align="center" >';
        xx = xx + PlayerTwo.name;
        xx = xx + '</th></tr>';        
        $('#result').append(xx);

    }, 5000);
}

$(window).ready(function () {
    $('.nmb').attr('disabled', 'disabled');
    $('#start').attr('hidden', 'hidden');
    $('#end').click(function () {

        var msg = $(this).val().toLowerCase();
        window.hubReady.done(function () {
            guessHub.server.choice(msg, ChannelName.name, PlayerOne.name);
        });
    });
    $('#restart').click(function () {
        var msg = $(this).val().toLowerCase();
        aiGuesses = [];
        pNumbers = getUniqueNumbers();
        env.possibleNumbers = env.generateUniqueNumbers();
        state = env.reset();
        $('#result').empty();
        $('#details').empty();
        $('.nmb').removeAttr('disabled');
        $('#restart').attr('disabled', 'disabled');
        if (isComputer) {
            hideDiv();
        } else {
            window.hubReady.done(function () {
                guessHub.server.choice(msg, ChannelName.name, PlayerOne.name);
            });
        }
    });
    $('#pause').click(function () {
        var msg = $(this).val().toLowerCase();
        window.hubReady.done(function () {
            guessHub.server.choice(msg, ChannelName.name, PlayerOne.name);
        });
    });
    $('#tchoice').click(function () {
        if ($(this).is(':checked')) {
            $('#game').append('<span id="ttime"></span>');
        }
    });
    $('#Enter').click(function () {
        setupSignalR();
        var check = userData();
        (check === true) ? $('#diva').attr('style', 'display:block;') : showDiv();
    });
    $('#numb').change(function () {
        displayNumber();
    });
    $('.nmb').click(function () {
        var index = (this.id);
        
        switch (index) {
            case "guess": guessNumber();
                break;
            case "clear": clearNumber(index);
                break;
            default: displayNumber(index);
                break;
        }


    });
    $('#play').click(function () {
        //setupsignalr();
        $('#Enter').removeAttr('disabled');
        $('#myleft').attr('style', 'display:none;');
        $('#diva').attr('style', 'display:block;');
    });
    $('#start').click(function () {


    });
    $('#smsg').click(function () {
        var msg = $('#pmsg').val().toLowerCase();
        $('#game').append('<li> You said:' + msg + '</li>');
        $('#pmsg').val("");
        window.hubReady.done(function () {
            guessHub.server.passMessage(msg, ChannelName.name);
        });
    });
    $('#ail').click(function () {
        SinglePlayer();
    });
});

var stopSignalR = function () {
    window.hubstop = $.connection.hub.stop();
    return window.hubstop;
};

function showDiv() {
    if (isRestart) { $('#userinfo').empty(); $('#userinfo').append(initUserinfo); $('#userinfo').one('click', function (e) { SinglePlayer(); }); yCount = null; tcount = 0; table = null; }
    $('#diva').attr('style', 'display:none;');
    $('#mybody').attr('style', 'display:block;');
}

function hideDiv() {
    $('#diva').attr('style', 'display:block;');
    $('#console').attr('style', 'display:none;');
    $('#number').val('');
    $('#Enter').removeAttr('disabled');
    isRestart = true;
}

function test() {
    console.log("yeap");
}

//function restart() {
//    $('#diva').attr('style', 'display:none;');
//    $('#mybody').attr('style', 'display:block;');

//    setTimeout(function () {
//        $('#mybody').fadeOut(2000);
//        $('#mybody').attr('style', 'display:none;')
//        $('#console').attr('style', 'display:block; margin-top:0px;');
//        var xx = '<tr><th align="center">';
//        xx = xx + PlayerOne.name.toString();
//        xx = xx + '</th><th align="center" >';
//        xx = xx + PlayerTwo.name;
//        xx = xx + '</th></tr>';
//        console.log(xx);
//        $('#result').append(xx);

//    }, 5000);
//}

function userData() {
    var check;
    p = $('#name').val().toString();
    q = $('#number').val().toString();
    var t;
    var ch = [0, 0, 0, 0];

    PlayerOne.name = p.toString();

    PlayerOne.number = q.toString(10).split("");

    //Number check
    var k = 0;
    var arr = ['0'];
    var are = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

    for (var i = 0; i < (PlayerOne.number).length; i++) {

        if (PlayerOne.number[i] === arr[0]) { t = 1; }
        for (var j = 0; j < 9; j++) {
            if (PlayerOne.number[i] === are[j]) { (ch[j])++; }
        }
    }
    for (var ii = 0; ii < 9; ii++) {
        if (ch[ii] > 1) { t = 1; }
    }

    if (t) {
        console.log('invalid number, your number may contain a 0 or has a value repeated');
        $('#errdetail').text('Invalid number, your number contains a 0 or has a value repeated.');
        check = true;
    }
    else {
        $('#Enter').attr('disabled', 'disabled')
        check = passNumber();

    }
    return check;
}

function passNumber(check) {
    switch ((PlayerOne.number).length) {
        case 4: saveMyConnectionId(PlayerOne.name);
            break;
        default: console.log('check to see your number has four digits correct'); $('#errdetail').text('check to see your number has four digits correct'); $('#Enter').removeAttr('disabled');
            return true;

    }

}

function displayNumber(val) {
    if (count <= 3) {
        $('#numb').val($('#numb').val().toString() + val);
        store = $('#numb').val().toString(10).split("");
        count++;
    }
    else {
        console.log("Your guess can have a maximum length of 4 only. Click Guess to continue, OR  Click Clear to change number"); $('#details').text("Your guess can have a maximum length of 4 only. Click Guess to continue, OR  Click Clear to change number");

    }
}

function clearNumber() {
    $('#numb').val("");
    count = 0;
}

function guessNumber() {   
    //var dnum = number.toString(10).split(".");

    if (store.length < 4) {
        console.log("the length of your guess is faulty please enter valid guess");
        $('#details').text("the length of your guess is faulty please enter valid guess");

    }
    else {

        for (var i = 0; i < 4; i++) {

            for (var j = 0; j < 4; j++) {
                if (i - 1 === j) { null }
                else {
                    if (store[i - 1] === store[j]) {
                        console.log("Please enter a valid number; numbers with repeated digits are not allowed");
                        $('#details').text("Please enter a valid number; numbers with repeated digits are not allowed");

                        i = 4;
                    }
                }
            }
            if (i === 3) {
                $('#numb').val('');
                var gnum = "";

                for (var k = 0; k < 4; k++) {
                    gnum = gnum + store[k];
                };
                store = gnum
                clearNumber();
                if (isComputer === false) {
                    window.hubReady.done(function () { guessHub.server.passNumber(ChannelName.name, gnum, "guess"); });
                }
                else {

                    var ff = evaluateGuess2(gnum, computerSecretNum.toString());
                    insCell();
                    if (isRestart) { }
                    if (ff.dead === 4) {
                        $('#details').text("You have won the Game. Congratulations!!!");
                        $('.nmb').attr('disabled', 'disabled');
                        $('#restart').removeAttr('disabled');
                        store = "";
                        return true;
                    }
                    $('.nmb').attr('disabled', 'disabled');
                    $('#details').text("computer's turn");
                    if (!agentdqn) {
                        comguess = makeAIGuess();//    reservoir sampling without replacement
                    }
                    else { env.secretNumber = (PlayerOne.number).join(''); predictUntilGoal(env, agent); }                    
                    store = comguess;
                    var f = evaluateGuess2(comguess.toString(), PlayerOne.number);
                    insCell();
                    if (f.dead === 4 || fourdead) {
                        $('#details').text("You have lost this time around to the " + PlayerTwo.name + ". " + PlayerTwo.name + "'s number is " + computerSecretNum + '. Better luck next time.');
                        $('.nmb').attr('disabled', 'disabled');
                        $('#restart').removeAttr('disabled');
                        store = "";
                    }
                    else {
                        filterAIPossibleNumbers(f, comguess);
                        $('.nmb').removeAttr('disabled');
                        $('#details').text("your turn");
                    }

                }//comparenumbers(gnum); }


            }
        }
    }


}

function insCell() {
    var ff = 'r' + tcount;
    table = document.getElementById("tab");
    //$("#tab").attr("style", "text-align:center;");
    var gg = '<tr id="' + ff + '"><td class="first" style="width:50%;"></td><td class="second" style="width:50%;"></td></tr>';
    /*console.log('ff = ' + ff + ' and gg = ' + gg + ' and store = ' + store + ' and ycount = ' + yCount);*/
    if (yCount === 0) {        
        if (initiator) {
            console.log('initiator = true and Second column');
            var bb = store + '-' + dead + "d " + wounded + "w";
            $('#' + ff).children('.second').append(bb);
            //$('#' + ff).append(bb);
            tcount++;
        }
        else {
            console.log('initiator = false and first column');
            var bbb = store + '-' + dead + "d " + wounded + "w";
            //$('#' + ff).find('td')[1]
            //var bb = '<td>' + wounded + "w" + dead + "d " + store + ' ' + '</td>';
            $('#' + ff).children('.first').append(bbb);
            //$('#' + ff).append(bb);
            tcount++;
        }
        yCount = counter;
    }

    else {

        if (initiator) {
            console.log('initiator = true and first column');
            var abb = store + '-' + dead + "d " + wounded + "w";
            $("#result").append(gg);
            //$('#' + ff).append(bb);
            $('#' + ff).children('.first').append(abb);
        }
        else {
            console.log('initiator = false and Second column');
            var cbb = store + '-' + dead + "d " + wounded + "w";
            //var bb = '<td>' + wounded + "w" + dead + "d " + store + ' ' + '</td>';
            $("#result").append(gg);
            //$("#tab").attr("dir", "rtl");
            //$('#' + ff).append(bb);  
            $('#' + ff).children('.second').append(cbb);
        }
        yCount = 0;
    }



    //if (yCount === 0) {
    //    y = x.insertCell(x.cells.length);
    //    y.width = 50;
    //    y.innerHTML = store +' ' + dead + "d " + wounded + "w";
    //    yCount = counter;
    //}
    //else {
    //    xCount = table.rows.length;
    //    x = table.insertRow(xCount);
    //    yCount = x.cells.length;
    //    y = x.insertCell(yCount);
    //    y.width = 50;
    //    y.innerHTML = store + ' ' + dead + "d " + wounded + "w";
    //}


}


var guessHubNotifs = function () {
    guessHub.client.receiveBroadcast = function (id) {
        return id;
    };
    guessHub.client.receiveMessage = function (msg) {
        $('#game').append('<li>' + PlayerTwo.name + ' says:' + msg + '</li>');
    };
    guessHub.client.inviteReply = function (msg) {
        return (msg);
    };
    guessHub.client.channel = function (ch) {
        return (ch);
    };
    guessHub.client.iAmConnected = function (id) {

    };
    guessHub.client.viewAllNames = function (id) {
    };
    guessHub.client.receiveName = function (name, id) {
        $('#userinfo').append('<a id = ' + id + ' class = "userdata" href = "#">' + name + '</a><br />');
        var b = "#" + id;
        $(b).off('click', function (e) { });
        $(b).one('click', function (e) { choice(id); });
    };
    guessHub.client.removeId = function (id) {
        var b = ("'#" + id + "'")
        var c = $('#userinfo').find(b);
        c.next().remove()
        $('#userinfo').find(b).remove(b);
    };
    guessHub.client.receiveInvite = function (id) {
        var b = "#" + id;
        var i = confirm(($(b).html()) + ' has invited you for a game of guess numbers. Do you want to play against ' + $(b).html() + '?')
        switch (i) {
            case true: //$('.nmb').removeAttr('disabled');
                PlayerTwo.name = $(b).html();
                UserId.id = id;
                //$('#numb1').val(PlayerOne.name);
                //$('#numb2').val(PlayerTwo.name);

                var xx = '<tr><th>';
                xx = xx + PlayerOne.name.toString();

                xx = xx + '</th><th>';
                xx = xx + PlayerTwo.name;
                xx = xx + '</th></tr>';                
                $('#result').append(xx);
                ChannelName.offer = i;
                window.hubReady.done(function () { guessHub.server.passReply(id, i.toString()); });
                break;
            case false: ChannelName.offer = i;
                window.hubReady.done(function () { guessHub.server.passReply(id, null); });
                break;
        }
    };
    guessHub.client.receiveToken = function (channel) {
        ChannelName.name = channel;
        $('#start').removeAttr('hidden');
        window.hubReady.done(function () { guessHub.server.useForPassReply(channel); });
    };
    guessHub.client.coolStore = function (id) {
        UserId.id = id;
        var b = '#' + id;
        PlayerTwo.name = $(b).html();

        //$('#numb1').val(PlayerOne.name);
        //$('#numb2').val(PlayerTwo.name);
        var xx = '<tr><th align="center">';
        xx = xx + PlayerOne.name.toString();
        xx = xx + '</th><th align="center" >';
        xx = xx + PlayerTwo.name;
        xx = xx + '</th></tr>';
        $('#result').append(xx);
        //$('#console').attr('style', 'display:block;');
    };
    guessHub.client.getNumber = function (dnum, type) {
        switch (type) {
            case "guess": comparenumbers(dnum);
                break;
            case "answer": reply(dnum);
                break;
        }
    };
    guessHub.client.rejection = function () {
        console.log(1)
    };
    guessHub.client.fail = function (e) {
        console.log(e)
    };
    guessHub.client.accept = function () {
        $('#userinfo').find('#avail').remove('#avail');
        $('#userinfo').find('.userdata').remove();
        $('#userinfo').html('');
        $('#userinfo').append('<h2 class= "sub-header">Profile</h2>');
        var xx = '<div class="table-responsive" style="width:300px;"><table class="table table-striped">';
        xx = xx + '<tr><td><ul><img src="pix/you.jpg" style="height:75px; width 75px;"></ul></td><table style="margin-top: -85px;margin-left: 150px;"><tr><td>' + PlayerOne.name + '</td></tr><tr><td>6 Wins</td></tr></table>';
        xx = xx + '<table><tr><td><ul style="height:25px; width 75px; text-align:center; margin-top:50px; margin-left:75px;">Vs.</ul></td></tr></table>';
        xx = xx + '<tr><td><ul><img src="pix/mimi.jpg" style="height:75px; width 75px; margin-top:0px; margin-left:5px;"></ul></td><table style="margin-top: -75px;margin-left: 150px;"><tr><td>' + PlayerTwo.name + '</td></tr><tr><td>6 Wins</td></tr></table>';
        //x = x + '<tr><td></td><td></td></tr>';
        xx = xx + '</table></div>';
        $('#userinfo').append(xx);
        //$('#start').removeAttr('hidden');
        if (initiator) {            
            $('.nmb').removeAttr('disabled');
            $('#details').text('Your turn.');
        }
        else {
            $('#details').text(PlayerTwo.name + "'s turn.");
        }
        $('#numb').val('');
        //$('#userinfo').append(PlayerOne.name + ' vs ' + PlayerTwo.name); 
        setTimeout(function () {
            $('#mybody').fadeOut(2000);
            $('#mybody').attr('style', 'display:none;')
            $('#console').attr('style', 'display:block; margin-top:0px;');

        }, 5000);
    };
    guessHub.client.gameaction = function (n, e) {        
        $('#details').text("");
        switch (e) {
            case "end": $('#details').append(n + " has quit the game. Do you want to choose another opponent? <a id='ryes'>yes</a>&nbsp;&nbsp;<a id='rno'>no</a>");

                $('#rno').on('click', function () {
                    $('#rno').off('click', function () { });
                    window.hubReady.done(function () {
                        //guessHub.server.choice($(this).val().toLowerCase(), ChannelName.name, PlayerOne.name);
                    });
                });
                $('#ryes').on('click', function () {
                    $('#ryes').off('click', function () { });
                    window.hubReady.done(function () {
                        //guessHub.server.choice($(this).val().toLowerCase(), ChannelName.name, PlayerOne.name);
                    });
                });
                //case "restart": $('#details').text(n + " has asked to restart the game. Click ok to confirm."); ;
                //    break;
                break;
            case "pause": $('#details').append(n + " has asked to pause the game.");
                break;
            case "replay": $('#details').append(n + " has asked for a replay of this game. Do you accept? <a id='ryes'>yes</a>&nbsp;&nbsp;<a id='rno'>no</a>");

                $('#rno').on('click', function () {
                    $('#rno').off('click', function () { });
                    window.hubReady.done(function () {
                        guessHub.server.choice($(this).val().toLowerCase(), ChannelName.name, PlayerOne.name);
                    });
                });
                $('#ryes').on('click', function () {
                    $('#ryes').off('click', function () { });
                    window.hubReady.done(function () {
                        guessHub.server.choice($(this).val().toLowerCase(), ChannelName.name, PlayerOne.name);
                    });
                });
                break;

        }
    };
};
var setupSignalR = function () {
    guessHub = $.connection.guessHub;
    $.connection.hub.logging = true;
    guessHubNotifs();
    window.hubReady = $.connection.hub.start().done(function () { console.log("Connected"); }).fail(function () { console.log("Could not Connect!"); });

};
var saveMyConnectionId = function (val) {

    window.hubReady.done(function () {
        guessHub.server.saveMyConnectionId(val.toString());
    });
};
var getConnectionIds = function () {
    window.hubReady.done(function () {
        videoChat.server.getAllNames();
    });
};
var choice = function (e) {
    var b = "#" + e
    var i = confirm('You have asked to play a game of guess numbers with ' + $(b).html());
    switch (i) {
        case true: passId(e);
            break;
    }
}
var passId = function (e) {
    initiator = true;
    window.hubReady.done(function () { guessHub.server.passId((e)); });
};
var reply = function (dnum) {
    dead = 0;
    wounded = 0;
    dnum = dnum.toString(10).split("");
    dead = dnum[0];
    wounded = dnum[1];
    insCell();    
    $('.nmb').attr('disabled', 'disabled');
    if (parseInt(dead) === 4) {
        $('#details').text("You have won the Game. Congratulations!!!");
    }
    else {

        $('#details').text(PlayerTwo.name + "'s Turn.");
    }
    store = ""; wounded = 0; dead = 0;
};
var comparenumbers = function (dnum) {
    store = dnum;
    dnum = dnum.toString(10).split("");
    for (var k = 0; k < 4; k++) {
        if (dnum[k] === PlayerOne.number[k]) { dead++; }

        for (var l = 0; l < 4; l++) {
            if (k === l) { null }
            else { if (dnum[l] === PlayerOne.number[k]) { wounded++; } }
        }
    }
    var t = dead.toString() + wounded.toString();
    insCell();
    
    if (parseInt(dead) === 4) {
        $('#details').text("You have lost this time around to " + PlayerTwo.name + ". " + PlayerTwo.name + "'s number is " + store + '. Better luck next time.');
    }
    else {
        $('.nmb').removeAttr('disabled');
        $('#details').text('Your Turn.');
    }
    store = ""; wounded = 0; dead = 0;
    if (isComputer === false) {
        window.hubReady.done(function () { guessHub.server.passNumber(ChannelName.name, t, "answer"); });
    }
    else { }

};
var getUniqueNumbers = function () {
    let numbers = [];
    for (let i = 1234; i <= 9876; i++) {
        let numStr = i.toString();
        let digits = new Set(numStr);
        if (digits.size === 4 && !numStr.includes('0')) { // Check if all digits are unique
            numbers.push(i);
        }
    }
    return numbers;
}
var filterAIPossibleNumbers = function (feedback, guess) {
   
    pNumbers = pNumbers.filter(nm => {
        let evaluation = evaluateGuess2(nm.toString(), guess.toString());
        return evaluation.dead === feedback.dead && evaluation.wounded === feedback.wounded;
    });
    console.log(`After filtering, ${pNumbers.length} possible numbers remain.`);
    if (pNumbers.length < 50) { console.log(pNumbers);}

}

var makeAIGuess = function () {
    let guess;
    do {
        guess = this.pNumbers[Math.floor(Math.random() * this.pNumbers.length)];        
    } while (aiGuesses.indexOf(guess) !== -1);

    aiGuesses.push(guess); // Track AI's guess to avoid duplication
    return guess;
}

var evaluateGuess2 = function (guess, secret) {    
    dead = 0; wounded = 0;
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
                //console.log("guess[i] = " + guess[i] + "; secret[i]= " + secret[j]);
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
var useDQN = function () {


}
async function predictUntilGoal(environment, agent) {

    let done = false;

    // Get action from the agent    
    const action = agent.act(state);
    
    if (typeof action === "number") {
        comguess = environment.possibleNumbers[action];
        
    } else {
        comguess = action;
        
        
    }
    // Step in the environment with the action
    const stepResult = environment.step(action);
    const { reward, done: isDone, next_state} = stepResult;
    //const nextState = tf.tensor2d([next_state], [1, stateSize]);    
    // Update state for the next prediction
    state = next_state;

    // Check if the goal is achieved
    if (isDone) {
        fourdead = true;
        
    } else {
        fourdead = false;
        //agent.actionSize = environment.possibleNumbers.length;        
    }    
}

// Use the function
console.log(agent);
let env = new NumberGuessingEnvironment();
//let initialState = env.reset();
//console.log('Initial State length:', initialState.length);
let state = env.reset();//tf.tensor2d([initialState], [1, stateSize]);
var pNumbers = getUniqueNumbers();
env.possibleNumbers = env.generateUniqueNumbers();

