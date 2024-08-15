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

const bucket = 'ffs-demos';

async function getSignedDownloadUrl(path) {
	let command = new GetObjectCommand({ Bucket: bucket, Key:path });
	return await getSignedUrl(s3Client, command, { expiresIn: 3600 });
}

async function getSignedUploadUrl(path) {
	let command = new PutObjectCommand({ Bucket: bucket, Key:path });
	return await getSignedUrl(s3Client, command, { expiresIn: 3600 });
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

async function makeATJob(input, output, id, token) {
	let data = {
		"inputs": {
			"href": input,
			"storage": "external"
		},
		"outputs": [{
			"href": output,
			"storage": "external",
			"type":"image/jpeg",
			"overwrite": true
		}]
	};				

	let resp = await fetch('https://image.adobe.io/lrService/autoTone', {
		headers: {
			'Authorization':`Bearer ${token}`,
			'x-api-key': id,
			'Content-Type':'application/json'
		}, 
		method:'POST',
		body:JSON.stringify(data)
	});

	return await resp.json();
}

// Lame function to add a delay to my polling calls
async function delay(x) {
	return new Promise(resolve => {
		setTimeout(() => resolve(), x);
	});
}


// Assumes you checked out the repo
let rootDir = '../../../assets/totone/';
let files = fs.readdirSync(rootDir);
console.log(`To process, ${files.length} images.`);

let token = await getAccessToken(CLIENT_ID, CLIENT_SECRET);
console.log('Got the access token.');

for(let i=0; i<files.length;i++) {

	let f = files[i];

	// first, upload to our bucket
	let uploadUrl = await getSignedUploadUrl(f);
	await uploadFile(uploadUrl, rootDir + f);
	console.log(`Uploaded ${f} to cloud storage.`);

	let readUrl = await getSignedDownloadUrl(f);

	let outputUrl = await getSignedUploadUrl(`improved_${f}`);

	let job = await makeATJob(readUrl, outputUrl, CLIENT_ID, token);
	let jobUrl = job._links.self.href;

	let status = '';
	while(status !== 'succeeded' && status !== 'failed') {

		let resp = await fetch(jobUrl, {
			headers: {
				'Authorization':`Bearer ${token}`,
				'x-api-key': CLIENT_ID
			}
		});
		let data = await resp.json(); 
		status = data.outputs[0].status;
		console.log(`Current status: ${status}`);
		if(status !== 'succeeded' && status !== 'failed') await delay(1000);
	}

	// download from cloud
	let downloadUrl = await getSignedDownloadUrl(`improved_${f}`);
	// saves to same direction as script
	await downloadFile(downloadUrl, `improved_${f}`);
	console.log('Downloaded improved image.');
};