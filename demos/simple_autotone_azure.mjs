/*
In case it isn't obvious, I'm just an Azure version of simple_autotone.js
*/

import { BlobServiceClient, BlobSASPermissions, generateBlobSASQueryParameters, StorageSharedKeyCredential } from "@azure/storage-blob";

// Credentials for PS API
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

// Credentials for Azure
const AZURE_ACCOUNTNAME = process.env.AZURE_ACCOUNTNAME;
const AZURE_KEY = process.env.AZURE_KEY;
const AZURE_CONTAINERNAME = process.env.AZURE_CONTAINERNAME;
const AZURE_CONNECTIONSTRING = process.env.AZURE_CONNECTIONSTRING;

const blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_CONNECTIONSTRING);
const containerClient = blobServiceClient.getContainerClient(AZURE_CONTAINERNAME);


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

async function makeATJob(input, output, id, token) {
	let data = {
		"inputs": {
			"href": input,
			"storage": "azure"
		},
		"outputs": [{
			"href": output,
			"storage": "azure",
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


let token = await getAccessToken(CLIENT_ID, CLIENT_SECRET);

let inputURL = await getSignedDownloadUrl('goodsourceimage.jpg', AZURE_KEY, AZURE_ACCOUNTNAME, AZURE_CONTAINERNAME);
let uploadURL = await getSignedUploadUrl('betterimage.jpg', containerClient, AZURE_CONTAINERNAME);

let job = await makeATJob(inputURL, uploadURL, CLIENT_ID, token);
console.log(job); 
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

