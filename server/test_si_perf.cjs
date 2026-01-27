const si = require('systeminformation');

async function testSI() {
    console.log('Testing OS Info...');
    console.time('osInfo');
    await si.osInfo();
    console.timeEnd('osInfo');

    console.log('Testing CPU load...');
    console.time('currentLoad');
    await si.currentLoad();
    console.timeEnd('currentLoad');

    console.log('Testing Full Stats (Parallel)...');
    console.time('fullStats');
    await Promise.all([
        si.currentLoad(),
        si.cpu(),
        si.mem(),
        si.fsSize(),
        si.networkStats(),
        si.cpuTemperature(),
        si.time(),
        si.osInfo(),
    ]);
    console.timeEnd('fullStats');
}

testSI();
