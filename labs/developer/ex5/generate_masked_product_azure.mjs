/*
My responsibility is to take the product and create the mask.
In order for it to work with Firefly, we need to invert the mask.
So we'll create mask and than invert the mask.

I should be run once.
*/

import fs from 'fs';
import { Readable } from 'stream';
import { finished } from 'stream/promises';

import { BlobServiceClient, BlobSASPermissions, generateBlobSASQueryParameters, StorageSharedKeyCredential } from "@azure/storage-blob";

// Credentials for Azure
const AZURE_ACCOUNTNAME = process.env.AZURE_ACCOUNTNAME;
const AZURE_KEY = process.env.AZURE_KEY;
const AZURE_CONTAINERNAME = process.env.AZURE_CONTAINERNAME;
const AZURE_CONNECTIONSTRING = process.env.AZURE_CONNECTIONSTRING;

const blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_CONNECTIONSTRING);
const containerClient = blobServiceClient.getContainerClient(AZURE_CONTAINERNAME);

// Credentials for Firefly Services
let CLIENT_ID = process.env.CLIENT_ID;
let CLIENT_SECRET = process.env.CLIENT_SECRET;

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

function createSASReadString(key, accountName, containerName, duration=5) {
	
	let permissions = new BlobSASPermissions();
	permissions.read = true;

	let currentDateTime = new Date();
	let expiryDateTime = new Date(currentDateTime.setMinutes(currentDateTime.getMinutes()+duration));
	let blobSasModel = {
		containerName,
		permissions,
		expiresOn: expiryDateTime
	};

	let credential = new StorageSharedKeyCredential(accountName,key);
	return generateBlobSASQueryParameters(blobSasModel,credential);

}

function getSignedDownloadUrl(name, key, accountName, containerName) {
	let b = containerClient.getBlockBlobClient(name);
	return b.url + '?' + createSASReadString(key, accountName, containerName);
}

async function getSignedUploadUrl(name, client, containerName, duration=5) {
	let permissions = new BlobSASPermissions();
	permissions.write = true;

	let currentDateTime = new Date();
	let expiryDateTime = new Date(currentDateTime.setMinutes(currentDateTime.getMinutes()+duration));
	let blobSasModel = {
		containerName,
		permissions,
		expiresOn: expiryDateTime
	};

	let tempBlockBlobClient = client.getBlockBlobClient(name);
	return await tempBlockBlobClient.generateSasUrl(blobSasModel);
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
			'Content-Length':size,
			'x-ms-blob-type':'BlockBlob'
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
			"storage": "azure"
  		},
		"output": {
		    "href": output,
		    "storage": "azure",
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
			"storage":"azure",
			"href":input
		}],
		"options":{
			actionJSON
		},
		"outputs":[ {
			"storage":"azure",
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
let uploadURL = await getSignedUploadUrl(fileName, containerClient, AZURE_CONTAINERNAME);
await uploadFile(uploadURL, sourceInput);
console.log(`Uploaded ${sourceInput} to cloud storage.`);

let inputURL = await getSignedDownloadUrl(fileName, AZURE_KEY, AZURE_ACCOUNTNAME, AZURE_CONTAINERNAME);
let maskedFileName = `masked_${fileName}`;
let outputURL = await getSignedUploadUrl(maskedFileName, containerClient, AZURE_CONTAINERNAME);

let maskJob = await createMask(inputURL, outputURL, CLIENT_ID, token);
console.log('Created Mask Job, will now start checking status...')

let result = await pollJob(maskJob['_links'].self.href, CLIENT_ID, token);
console.log('Done and assuming success', result);

let invertedMaskFileName = `inverted_${fileName}`;
inputURL = await getSignedDownloadUrl(maskedFileName, AZURE_KEY, AZURE_ACCOUNTNAME, AZURE_CONTAINERNAME);
let outputInvertedURL = await getSignedUploadUrl(invertedMaskFileName, containerClient, AZURE_CONTAINERNAME);

let actionJob = await createActionJSON(inputURL, outputInvertedURL, action, CLIENT_ID, token);
console.log('Created ActionJSON Job, will now start checking status...')

result = await pollJob(actionJob['_links'].self.href, CLIENT_ID, token);
console.log('Job done, downloading...');

let finalURL = await getSignedDownloadUrl(invertedMaskFileName, AZURE_KEY, AZURE_ACCOUNTNAME, AZURE_CONTAINERNAME);
await downloadFile(finalURL, invertedMaskFileName);
console.log('Done');
