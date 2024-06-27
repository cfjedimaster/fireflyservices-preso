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
		numVariations:1, 
		prompt,
		size: {
			width: 1024, 
			height: 1024
		}
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

async function expandImage(url, size, id, token) {

	let body = {
		numVariations:1, 
		image: {
			source: {
				url
			}
		},
		size
	}

	let req = await fetch('https://firefly-api.adobe.io/v3/images/expand', {
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

async function delay(x) {
	return new Promise(resolve => {
		setTimeout(() => resolve(), x);
	});
}

let prompts = (fs.readFileSync('./prompts.txt','utf8')).trim().split('\n');

/*
Available sizes for Gen Expand taken from: https://developer.adobe.com/firefly-services/docs/firefly-api/guides/api/generative_expand/V3/
*/
let sizes = [{ width: 2500, height: 2500}, {width: 2000, height: 2000}, {width:2500, height: 2000}];

let token = await getAccessToken(CLIENT_ID, CLIENT_SECRET);

for(let prompt of prompts) {
	
	console.log(`Generating an image for prompt: ${prompt})`);

	let result = await textToImage(prompt, CLIENT_ID, token);
	
	let outputUrl = result.outputs[0].image.url;
	console.log('Image generated');

	for(let size of sizes) {
		console.log(`Expanding to: ${size.width}x${size.height}`);
		let expanded = await expandImage(outputUrl, size, CLIENT_ID, token);

		let filename = `${prompt}-${size.width}-${size.height}.jpg`;
		// quick and dirty hack, better option is @sindresorhus/slugify
		filename = filename.replaceAll(' ', '-');
		console.log(`Saving to ${filename}`);
		await downloadFile(expanded.outputs[0].image.url, filename);

	}

	// This is one simple way to handle RPM issues.
	console.log('Pausing a bit between prompts (10 seconds)');
	await delay(10 * 1000);
	console.log('\n');

}

console.log('\nAll done.');