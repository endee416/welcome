{
  "name": "school-chow-server",
  "version": "1.0.0",
  "description": "Backend server for School Chow email verification system using Hostinger SMTP",
  "main": "index.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "body-parser": "^1.20.2",
    "nodemailer": "^6.9.1",
    "firebase-admin": "^11.0.1",
    "dotenv": "^16.0.3"
  },
  "devDependencies": {
    "nodemon": "^2.0.20"
  },
  "author": "Endee",
  "license": "ISC"
}
