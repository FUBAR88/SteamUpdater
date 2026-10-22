const fs = require('fs');
const path = require('path');
const settings = require('./settings');

function pad(value) {
  return String(value).padStart(2, '0');
}

function parts(date) {
  return {
    day: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  };
}

function logFile(date) {
  const when = date || new Date();
  return path.join(settings.get().dataFolder, 'Logs', `${parts(when).day}.log`);
}

function write(line) {
  const text = String(line || '').trim();
  if (!text) {
    return;
  }
  const now = new Date();
  const file = logFile(now);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `[${parts(now).time}] ${text}\n`, 'utf8');
  } catch (error) {
    // A log failure must not stop a pull or a push.
  }
}

module.exports = {
  logFile,
  write
};
