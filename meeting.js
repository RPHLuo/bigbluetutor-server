var crypto = require('crypto');
var https = require('https');

function createRoom(meetingId, fullName, callback) {
  const defaultModeratorPassword = "mp";
  const defaultAttendeePassword = "ap";
  var meetingId = meetingId.split(' ').join('+');
  var fullName = fullName.split(' ').join('+');
  const salt = "71e7dd129aaf69637571472f77aa3723";
  var url = 'https://tutor.blindside-dev.com/bigbluebutton/api/create?';
  var params = 'name=' + meetingId + '&meetingID=' + meetingId  + '&attendeePW=' + defaultAttendeePassword + '&moderatorPW=' + defaultModeratorPassword + '&record=false';
  var checksum = crypto.createHash('sha1').update('create' + params + salt).digest('hex');
  url += params + '&checksum=' + checksum;
  
  https.get(url, function(res) {
//    console.log(res);
    var meetingUrl = 'https://tutor.blindside-dev.com/bigbluebutton/api/join?';
    var voiceBridge = Math.floor(Math.random() * (90000) + 10000);
    var params = 'fullName=' + fullName + '&meetingID=' + meetingId + '&password=' + defaultAttendeePassword + '&voiceBridge=' + voiceBridge + '&redirectClient=true&clientURL=https://tutor.blindside-dev.com/html5client/join';
    var checksum = crypto.createHash('sha1').update('join' + params + salt).digest('hex');
    meetingUrl += params + '&checksum=' + checksum;

    console.log(meetingUrl);    

    callback(meetingUrl);
  });
}

module.exports = createRoom;