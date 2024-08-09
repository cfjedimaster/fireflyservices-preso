import fs from 'fs';
import { Readable } from 'stream';
import { finished } from 'stream/promises';
import slugify from '@sindresorhus/slugify';


// Credentials for Firefly Services
let CLIENT_ID = process.env.CLIENT_ID;
let CLIENT_SECRET = process.env.CLIENT_SECRET;


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

	let data = await resp.json();
	return data.access_token;
}

async function uploadImage(filePath, fileType, id, token) {

	let stream = fs.createReadStream(filePath);
	let stats = fs.statSync(filePath);
	let fileSizeInBytes = stats.size;

	let upload = await fetch('https://firefly-api.adobe.io/v2/storage/image', {
		method:'POST', 
		headers: {
			'Authorization':`Bearer ${token}`, 
			'X-API-Key':id, 
			'Content-Type':fileType, 
			'Content-Length':fileSizeInBytes
		}, 
		duplex:'half', 
		body:stream
	});

	return (await upload.json()).images[0].id;
}

async function fillImage(prompt, source, mask, id, token) {

	let body = {
		prompt,
		numVariations:4,
		image: {
			source: {
				uploadId: source
			}, 
			mask: {
				uploadId: mask
			}
		}
	}

	let req = await fetch('https://firefly-api.adobe.io/v3/images/fill', {
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

let token = await getAccessToken(CLIENT_ID, CLIENT_SECRET);
let sourceInput = '../../../assets/sports_bottle.jpg';

let sourceImg = await uploadImage(sourceInput, 'image/jpeg', CLIENT_ID, token);
let maskImg = await uploadImage('./inverted_a_sports_bottle_on_a_table.jpg', 'image/jpeg', CLIENT_ID, token);
console.log('Source and mask uploaded');

let prompt = 'a moonlit beach at night';
let result = await fillImage(prompt, sourceImg, maskImg, CLIENT_ID, token);
for(let i of result.outputs) {
	let fileName = `${slugify(prompt)}-${i.seed}.jpg`;
	await downloadFile(i.image.url, fileName);
	console.log(`Downloaded ${fileName}`);
}
