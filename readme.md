# Firefly Services Presentation Repo

Welcome to my repository for [Adobe Firefly Services](https://developer.adobe.com/firefly-services/) presentations. This is mainly for people attending my presentations/labs/etc who need a copy of the slide decks or demos being used. 

(I'll write more here once I've got more to share. ;)

## Labs

This is a listing of the labs (currently in the `developer` subdirectory) including what the person is asked to build and notes about the solutions.

All solutions use an S3 bucket.

### Exercise 1

* Build an image generation tool using the Firefly API and a custom prompt
* Pass in the prompt via the command line
* Optionally save the results to the file system
* Optionally use a file for input

`ex1/generate.mjs` does this the bare minimum.

`ex1/generate2.mjs` demonstrates saving the results.

`ex1/generate3.mjs` demonstrates saving the results and using a text file for input.

### Exercise 2

* Write code that scans a folder of images
* Uploads them to cloud storage
* Runs the Lightroom AutoTone on them
* Saves results back to file system
* Note: You can skip the "upload/download" part if you wish and just work in cloud storage.
* GitHub repo has sample images in assets/totone

`ex2/process.mjs` has the solution.

### Exercise 3

* Create a dynamically driven image creation tool
* Read from a text file of prompts
* For each prompt, generate one image (sized 1024 x 1024)
* Then generate an expanded image (optionally create multiple different sizes)
* Remember: The API creates URLs as outputs, and many methods support URLs as input

`ex3/generate.mjs` has the solution.

### Exercise 4

* Write code to automate background removal
* Like Exercise 2, scan a folder and upload to cloud storage for processing
* Again, you can download, or keep in cloud storage
* How will you handle unique names?
* GitHub repo has samples images in assets/removebg

`ex4/process.mjs` has the solution.

### Exercise 5

* Builds on last lab
* Take an image and remove the background
* Generate a new image using a prompt and apply the main item from the previous image to the result
* Again, you can download, or keep in cloud storage

`ex5/generate_masked_product.mjs` handles taking the product, making a mask and inverting it.

`ex5/create_dynamic_image.mjs` is the solution using GenFill

`ex5/create_dynamic_image2.mjs` makes use of Object Composition using the product w/o a background.

`ex5/create_dynamic_image3.mjs` also uses Object Composition but with a mask.

### Exercise 6

* Given a source PSD file...
* Use the "Apply PSD Edits" API to update text and output images
* https://developer.adobe.com/firefly-services/docs/photoshop/api/photoshop_applyPsdEdits/
* Process should pass in a set of tag lines (text file perhaps)
* And generate output URLs for the various sizes

`ex6/generate.mjs` is the solution.

`ex6/generate2.mjs` demonstrates dynamic colors with each text value.

## Useful Scripts/Tips

All examples/labs make use of environment variables. I test using `.env` files and this command: `node --env-file=.env script.mjs`.

### Authentication

Here's a Node.js version:

```
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
```

### Cloud Stuff (S3)

Setup:

```js
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

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
```

Signed URLs:

```
async function getSignedDownloadUrl(path) {
	let command = new GetObjectCommand({ Bucket: bucket, Key:path });
	return await getSignedUrl(s3Client, command, { expiresIn: 3600 });
}

async function getSignedUploadUrl(path) {
	let command = new PutObjectCommand({ Bucket: bucket, Key:path });
	return await getSignedUrl(s3Client, command, { expiresIn: 3600 });
}
```

### File Transfer

```js
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
```