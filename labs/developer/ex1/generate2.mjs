import fs from 'fs';
import { Readable } from 'stream';
import { finished } from 'stream/promises';

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

async function getAccessToken(id, secret) {

	const params = new URLSearchParams();

	params.append('grant_type', 'client_credentials');
	params.append('client_id', id);
	params.append('client_secret', secret);
	params.append('scope', 'openid,AdobeID,firefly_enterprise,firefly_api,ff_apis');
	
	let resp = await fetch('https://ims-na1.adobelogin.com/ims/token/v3', 
		{ 
			method: 'POST', 
			body: params
		}
	);

	return (await resp.json()).access_token;
}

async function textToImage(prompt, id, token) {

	let body = {
		numVariations:4, 
		prompt
	}

	let req = await fetch('https://firefly-api.adobe.io/v3/images/generate', {
		method:'POST',
		headers: {
			'X-Api-Key':id, 
			'Authorization':`Bearer ${token}`,
			'Content-Type':'application/json'
		}, 
		body: JSON.stringify(body)
	});

	return await req.json();
}

async function downloadFile(url, filePath) {
	let res = await fetch(url);
	const body = Readable.fromWeb(res.body);
	const download_write_stream = fs.createWriteStream(filePath);
	return await finished(body.pipe(download_write_stream));
}

let prompt;

if(process.argv.length < 3) {
	console.error('Pass in your prompt as an argument.');
	process.exit(1);
} else prompt = process.argv[2];

console.log(`Generating an image based on the prompt: ${prompt}`);

let token = await getAccessToken(CLIENT_ID, CLIENT_SECRET);

let result = await textToImage(prompt, CLIENT_ID, token);

console.log(JSON.stringify(result,null,'\t'));

for(let output of result.outputs) {
	let fileName = `./${output.seed}.jpg`;
	await downloadFile(output.image.url, fileName);
}
