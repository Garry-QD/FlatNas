
const url = 'http://localhost:3000/api/webhook/lucky/stun';

const data = {
  stun: 'success',
  ip: '127.0.0.1',
  port: 54321
};

console.log('Sending webhook to', url);

try {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });

  const json = await response.json();
  console.log('Response:', json);
} catch (error) {
  console.error('Error:', error);
}
