This tutorial will walk you through basic viewer setup. It tries to avoid discussing
more complex options available to make things simpler. First, let's familiarize ourselves with 
the basic information required.

## WSI Slides
WSI images are high-resolution images, with sizes in hundreads of megabytes to unis of gigabytes.
The images inside WSIs are saved in "pyramid" structure:
    <div style="margin: 20px;max-width: 450px;">
    ![WSI Pyramid](https://www.researchgate.net/publication/353893643/figure/fig2/AS:1056513544179712@1628903866268/WSI-images-are-stored-in-a-pyramidal-format-where-the-base-image-corresponds-to-the.png)
    </div>

## Image Server
To load tiles (parts of the image) from these WSI pyramids, we can use High-resolution Image Server. 
There are many options to chose from; here, we will be using our RationAI's - [WSI-Service](https://github.com/RationAI/WSI-Service)
image server.

## xOpat
xOpat does not have _the viewer_ to use, there is no hardwired backend. Therefore, we will be connecting
the viewer to our image server. xOpat is able to connect to the image server through an `image protocol` 
and ask for the exact tiles in the exact resolution at which the image is viewed - this allows
viewing WSIs in real-time.
