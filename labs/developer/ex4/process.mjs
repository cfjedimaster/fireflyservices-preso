import fs from 'fs';
import { Readable } from 'stream';
import { finished } from 'stream/promises';

import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

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
// Folder to scan
const folder = '../../../assets/removebg/';

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

// Currently assumes an image
async function uploadFile(url, filePath) {
	let size = fs.statSync(filePath).size;

	await fetch(url, {
		method:'PUT', 
		headers: {
			'Content-Type':'image/*',
			'Content-Length':size
		},
		body: fs.readFileSync(filePath)
	});

}

async function getAccessToken(id, secret) {

	const params = new URLSearchParams();

	params.append('grant_type', 'client_credentials');
	params.append('client_id', id);
	params.append('client_secret', secret);
	params.append('scope', 'firefly_api,ff_apis,openid,AdobeID,session,additional_info,read_organizations');

	let resp = await fetch('https://ims-na1.adobelogin.com/ims/token/v3', 
		{ 
			method: 'POST', 
			body: params
		}
	);

	return (await resp.json()).access_token;
}

async function removeBG(input, output, id, token) {

	let data = {
		"input": {
			"href": input,
			"storage": "external"
  		},
		"output": {
		    "href": output,
		    "storage": "external",
    		"overwrite": true
		}
	};

	let resp = await fetch('https://image.adobe.io/sensei/cutout', {
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
		if(status !== 'succeeded' && status !== 'failed') await delay(1000);
	}

	return status;

}

let token = await getAccessToken(CLIENT_ID, CLIENT_SECRET);
console.log('Got the access token.');

let files = fs.readdirSync(folder);

/*
For each file, we're going to upload to s3 bucket. We SHOULD look for name conflicts or use a UUID perhaps.
*/
for(let f of files) {
	console.log(`Working on ${f}`);
	// first generate an upload link
	let inputPath = `input/${f}`;
	let uploadUrl = await getSignedUploadUrl(inputPath);
	await uploadFile(uploadUrl, folder + f);
	console.log(`Uploaded ${f} to cloud storage.`);

	let inputUrl = await getSignedDownloadUrl(inputPath);

	let outputPath = `output/${f}`;
	let outputUrl = await getSignedUploadUrl(outputPath);

	let job = await removeBG(inputUrl, outputUrl, CLIENT_ID, token);
	let result = await pollJob(job['_links'].self.href, CLIENT_ID, token);

	let readableOutputUrl = await getSignedDownloadUrl(outputPath);

	await downloadFile(readableOutputUrl, `./${f}_process.jpg`);
	console.log('Down removing background and saved result.');

}