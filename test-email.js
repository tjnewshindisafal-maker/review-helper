const nodemailer = require('nodemailer');
const t = nodemailer.createTransport({
  service: 'gmail',
  auth: { 
    user: 'advizrmedia@gmail.com', 
    pass: 'bnyh vgyb ibwv cjey'
  }
});
t.sendMail({
  from: 'advizrmedia@gmail.com',
  to: 'advizrmedia@gmail.com',
  subject: 'Test - Low Rating Alert',
  text: '2 star rating received from Reshine Studio!'
}, function(err, info){
  if(err) console.log('ERROR:', err.message);
  else console.log('SUCCESS:', info.response);
});
