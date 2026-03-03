# SMS Gateway

Simple Express service that forwards SMS requests to a local GSM modem via the [gammu](https://wammu.eu/gammu/) CLI.

## Configuration

| Variable | Description | Default |
| --- | --- | --- |
| SMS_GATEWAY_PORT | Port where the gateway listens | 7071 |
| SMS_BACKEND | Backend transport; only gammu is supported | gammu |
| GSM_DEVICE | Path to the GSM modem device (optional) | /dev/ttyUSB0 |

## Running

1. Install [gammu](https://wammu.eu/download/). On Debian/Ubuntu:
   `ash
   sudo apt install gammu
   `
2. Configure the modem (see [gammu-docs](https://wammu.eu/docs/manual/)) and test with gammu --identify.
3. Run the gateway:
   `ash
   npm install
   npm start
   `
4. Send SMS via POST /send-sms with { to: '+919xxxxxxxxx', message: 'Your OTP 123456' }.

### Error handling

- If gammu is not installed, the gateway responds with 500 and the message Gammu not installed.
- Make sure the modem is unlocked and the device path matches GSM_DEVICE.
