/*
My responsibility is to take the product and create the mask.
In order for it to work with Firefly, we need to invert the mask.
So we'll create mask and than invert the mask.

I should be run once.
*/

import fs from 'fs';
import { Readable } from 'stream';
import { finished } from 'stream/promises';

import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Bucket that stores our test files
const S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY;
const S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID;

const s3Client = new S3Client({ 
	region: 'us-east-1',
	credentials: {
		secretAccessKey: S3_SECRET_ACCESS_KEY, 
		accessKeyId: S3_ACCESS_KEY_ID
	}
});

let bucket = 'ffs-demos';

// Credentials for Firefly Services
let CLIENT_ID = process.env.CLIENT_ID;
let CLIENT_SECRET = process.env.CLIENT_SECRET;

//let sourceInput = '../../../assets/removebg/a_sports_bottle_on_a_table.jpg';
let sourceInput = '../../../assets/sports_bottle.jpg';
// actionJSON used to invert the mask
let action = [
	{
		"_obj": "invert"
	}
];

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
		//console.log(data);
		if(data.status) status = data.status;
		if(data.outputs && data.outputs[0].status) status = data.outputs[0].status;
		if(status !== 'succeeded' && status !== 'failed') await delay(1000);
	}

	return status;

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

	let data = await resp.json();
	return data.access_token;
}

async function createMask(input, output, id, token) {

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

	let resp = await fetch('https://image.adobe.io/sensei/mask', {
		method: 'POST', 
		headers: {
			'Authorization':`Bearer ${token}`,
			'x-api-key': id
		}, 
		body: JSON.stringify(data)
	});

	return await resp.json();

}

async function createActionJSON(input, output, actionJSON, id, token) {

	let data = {
		"inputs":[{
			"storage":"external",
			"href":input
		}],
		"options":{
			actionJSON
		},
		"outputs":[ {
			"storage":"external",
			"type":"image/png",
			"href":output
		}]
	};

	let resp = await fetch('https://image.adobe.io/pie/psdService/actionJSON', {
		method: 'POST', 
		headers: {
			'Authorization':`Bearer ${token}`,
			'x-api-key': id
		}, 
		body: JSON.stringify(data)
	});

	return await resp.json();
}

let token = await getAccessToken(CLIENT_ID, CLIENT_SECRET);
console.log('Got token for Firefly Services');

// First, upload source
let fileName = sourceInput.split('/').pop();
let uploadURL = await getSignedUploadUrl(fileName);
await uploadFile(uploadURL, sourceInput);
console.log(`Uploaded ${sourceInput} to cloud storage.`);

let inputURL = await getSignedDownloadUrl(fileName);
let maskedFileName = `masked_${fileName}`;
let outputURL = await getSignedUploadUrl(maskedFileName);

let maskJob = await createMask(inputURL, outputURL, CLIENT_ID, token);
console.log('Created Mask Job, will now start checking status...')

let result = await pollJob(maskJob['_links'].self.href, CLIENT_ID, token);
console.log('Done and assuming success', result);

let invertedMaskFileName = `inverted_${fileName}`;
inputURL = await getSignedDownloadUrl(maskedFileName);
let outputInvertedURL = await getSignedUploadUrl(invertedMaskFileName);

let actionJob = await createActionJSON(inputURL, outputInvertedURL, action, CLIENT_ID, token);
console.log('Created ActionJSON Job, will now start checking status...')

result = await pollJob(actionJob['_links'].self.href, CLIENT_ID, token);
console.log('Job done, downloading...');

let finalURL = await getSignedDownloadUrl(invertedMaskFileName);
await downloadFile(finalURL, invertedMaskFileName);
console.log('Done');
/*

inputURL = await getSignedDownloadUrl('invertmaskdemo/dog1_masked.png');
let outputInvertedURL = await getSignedUploadUrl('invertmaskdemo/dog1_masked_inverted.png');
console.log('Got signed URL for our inverted URL.');

let actionJob = await createActionJSON(inputURL, outputInvertedURL, action, CLIENT_ID, token);
console.log('Created ActionJSON Job, will now start checking status...', actionJob)

result = await pollJob(actionJob['_links'].self.href, CLIENT_ID, token);
*/