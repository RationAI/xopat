#!/bin/bash

echo "running script for downloading test image"

directory="/data"

# Check if the directory is empty
if [ -z "$(ls -A "$directory")" ]; then
    echo "The directory is empty."
    echo "starting download of test slide - This may take a while"
    mkdir /data/test_case
    curl "https://openslide.cs.cmu.edu/download/openslide-testdata/Generic-TIFF/CMU-1.tiff" > /data/test_case/test_slide.tiff
else
    echo "The directory is not empty."
    echo "nothing to do"
fi

echo "running the wsi-service"
./run.sh