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

`ex6/generate2.mjs` is a WIP (not working yet).