# WSI
- WSI is huge image, which have size in hundreads of megabytes.
- The images inside WSIs are saved in "pyramid" structure:
    ![](https://www.researchgate.net/publication/353893643/figure/fig2/AS:1056513544179712@1628903866268/WSI-images-are-stored-in-a-pyramidal-format-where-the-base-image-corresponds-to-the.png)

# Image Server
- To load tiles(parts of the image) from these WSI pyramids, we can use Image Server. There are many of them, but here, we will be using our RationAI's - [WSI-Service](https://github.com/RationAI/WSI-Service)
# xOpat
- Where in all of this is xOpat's place?
- xOpat is able to connect to the image server and ask for the exact images in exact resolution which are currently needed. 
- Thanks to that, we can use the ability of the Image Server which will let us pick only certain areas without loading unnecessary data and keep the process of viewing WSIs in real-time.