const crypto = require('node:crypto');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const readline = require('node:readline');
const { createInterface } = require('node:readline/promises');

const database = new DatabaseSync(path.join(__dirname, 'data', 'hodman.sqlite'));

function readHidden(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run this from the provided Windows .bat file so the password can be entered privately.');
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise(resolve => {
    let value = '';
    const finish = result => {
      process.stdin.off('keypress', onKeypress);
      process.stdin.setRawMode(false);
      process.stdout.write('\n');
      resolve(result);
    };
    const onKeypress = (character, key = {}) => {
      if (key.ctrl && key.name === 'c') {
        process.stdin.off('keypress', onKeypress);
        process.stdin.setRawMode(false);
        process.stdout.write('\nCancelled.\n');
        database.close();
        process.exit(130);
      }
      if (key.name === 'return' || key.name === 'enter') return finish(value);
      if (key.name === 'backspace') {
        if (value.length) {
          value = value.slice(0, -1);
          process.stdout.write('\b \b');
        }
        return;
      }
      if (character && !key.ctrl && !key.meta && character.length === 1) {
        value += character;
        process.stdout.write('*');
      }
    };
    process.stdout.write(prompt);
    process.stdin.on('keypress', onKeypress);
  });
}

async function main() {
  const admins = database.prepare("SELECT id,name,username FROM staff WHERE role='admin' AND active=1 ORDER BY id").all();
  if (!admins.length) throw new Error('No active administrator account was found.');

  console.log('Hodman administrator login recovery');
  admins.forEach((admin, index) => console.log(`${index + 1}. ${admin.username} (${admin.name})`));
  const choiceReader = createInterface({ input: process.stdin, output: process.stdout });
  const answer = admins.length === 1 ? '1' : await choiceReader.question('Choose the account number to reset: ');
  choiceReader.close();
  const selected = admins[Number(answer.trim()) - 1];
  if (!selected) throw new Error('Choose one of the listed account numbers.');

  const credentialReader = createInterface({ input: process.stdin, output: process.stdout });
  const username = (await credentialReader.question('New username (3–40 letters, numbers, dots, underscores or hyphens): ')).trim().toLowerCase();
  credentialReader.close();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new Error('Username must use 3–40 letters, numbers, dots, underscores or hyphens. Nothing was changed.');
  const existing = database.prepare('SELECT id FROM staff WHERE username=? COLLATE NOCASE AND id<>?').get(username, selected.id);
  if (existing) throw new Error('That username is already in use. Nothing was changed.');

  const password = await readHidden('New password (at least 8 characters): ');
  if (password.length < 8) throw new Error('Password must have at least 8 characters. Nothing was changed.');
  const confirmation = await readHidden('Enter the new password again: ');
  if (password !== confirmation) throw new Error('The passwords do not match. Nothing was changed.');

  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  database.exec('BEGIN IMMEDIATE');
  try {
    database.prepare('UPDATE staff SET username=?,password_hash=?,salt=? WHERE id=?').run(username, hash, salt, selected.id);
    database.prepare('DELETE FROM sessions WHERE staff_id=?').run(selected.id);
    database.prepare("INSERT INTO audit_logs(staff_id,action,entity_type,entity_id,detail) VALUES(?,'password_reset','staff',?,'Password reset with the local recovery tool')").run(selected.id, String(selected.id));
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  console.log(`Login updated for ${selected.username}. Sign in with username ${username} and your new password.`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(() => database.close());
