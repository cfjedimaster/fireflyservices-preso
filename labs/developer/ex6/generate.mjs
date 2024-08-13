import fs from 'fs';
import { Readable } from 'stream';
import { finished } from 'stream/promises';

import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import slugify from '@sindresorhus/slugify';

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

const S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY;
const S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID;

const s3Client = new S3Client({ 
	region: 'us-east-1',
	credentials: {
		secretAccessKey: S3_SECRET_ACCESS_KEY, 
		accessKeyId: S3_ACCESS_KEY_ID
	}
});

// Where we will work
const bucket = 'ffs-demos';

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

async function getSignedDownloadUrl(path) {
	let command = new GetObjectCommand({ Bucket: bucket, Key:path });
	return await getSignedUrl(s3Client, command, { expiresIn: 3600 });
}

async function getSignedUploadUrl(path) {
	let command = new PutObjectCommand({ Bucket: bucket, Key:path });
	return await getSignedUrl(s3Client, command, { expiresIn: 3600 });
}

async function downloadFile(url, filePath) {
	let res = await fetch(url);
	const body = Readable.fromWeb(res.body);
	const download_write_stream = fs.createWriteStream(filePath);
	return await finished(body.pipe(download_write_stream));
}

async function applyEdits(psd, text, outputs, id, token) {

	let data = {
		"inputs": [{
			"href": psd,
			"storage": "external"
  		}],
		"options": {
			"layers":[]
		},
		"outputs": []
	};

	for(let output of outputs) {
		/*
		Each output is a size key and url. We use this to specify the edit to the text layer AND an output

		First, the text layer
		*/
		let [width, height] = output.size.split('x');
		data.options.layers.push({
			"name":`${width}x${height}-text`,
			"edit":{},
			"text": {
				"content": text
			}
		});

		// Then an output
		data.outputs.push({
			"href":output.url,
			"storage":"external",
			"type":"image/jpeg",
			"trimToCanvas":true, 
			"layers":[
				{"name":`${width}x${height}`}
			]
		});
	}

	let resp = await fetch('https://image.adobe.io/pie/psdService/documentOperations', {
		method: 'POST', 
		headers: {
			'Authorization':`Bearer ${token}`,
			'x-api-key': id
		}, 
		body: JSON.stringify(data)
	});

	return await resp.json();

}

async function delay(x) {
	return new Promise(resolve => {
		setTimeout(() => {
			resolve();
		}, x);
	});
}

async function pollJob(jobUrl, id, token) {
	let status = '';

	while(status !== 'succeeded' && status !== 'failed') {

		let resp = await fetch(jobUrl, {
			headers: {
				'Authorization':`Bearer ${token}`,
				'x-api-key': id
			}
		});

		let data = await resp.json();

		if(data.status) status = data.status;
		if(data.outputs && data.outputs[0] && data.outputs[0].status) status = data.outputs[0].status;
		if(status !== 'succeeded' && status !== 'failed') await delay(1000);
	}

	return status;

}

let token = await getAccessToken(CLIENT_ID, CLIENT_SECRET);

// PSD already online, so get a readable link to it
let psdTemplate = await getSignedDownloadUrl('template.psd');
console.log('Generated a readable URL for your PSD template.');

let taglines = fs.readFileSync('./taglines.txt','utf8').trim().split('\n');

let sizes = ['1024x1408','1408x1024','1792x1024','1024x1024'];

for(let tagline of taglines) {
	console.log(`Doing tagline ${tagline}`);
	/*
	We need file names for our four outputs, and writable links
	*/
	let outputURLs = [];
	let downloadURLs = [];

	for(let size of sizes) {
		let [width,height] = size.split('x');
		let filename = `output/${slugify(tagline)}-${width}-${height}.jpg`;
		outputURLs.push(
			{
				size, 
				url: await getSignedUploadUrl(filename)
			});

		downloadURLs.push({
			name: filename,
			url:await getSignedDownloadUrl(filename)
		});
	}

	/*
	So at this point, we have a tagline, we have writable urls for the four sizes, time to call the API
	*/
	let job = await applyEdits(psdTemplate, tagline, outputURLs, CLIENT_ID, token);
	await pollJob(job['_links'].self.href, CLIENT_ID, token);

	for(let download of downloadURLs) {
		await downloadFile(download.url, download.name);
		console.log(`Saved ${download.name}`);
	}

}