# ICC Profile WASM Module

- clone little CMS 2 - v2.15
  - ````bash
    wget https://github.com/mm2/Little-CMS/releases/download/lcms2.15/lcms2-2.15.tar.gz
    tar -xzf lcms2-2.15.tar.gz
    ````
- install emscripten ('apt install emscripten') if not present

- build little cms 2
  ````
  cd lcms2-2.15

  # Refresh the helper scripts to recognize wasm
  wget -O config.sub  https://git.savannah.gnu.org/cgit/config.git/plain/config.sub
  wget -O config.guess https://git.savannah.gnu.org/cgit/config.git/plain/config.guess
  
  emconfigure ./configure \
    --host=wasm32-unknown-emscripten \
    --disable-shared --enable-static \
    --without-jpeg --without-tiff --without-zlib \
    CC=emcc AR=emar RANLIB=emranlib CFLAGS="-O3 -pthread"
  
  emmake make -j
  ```` 
- output is in ``src/.libs/liblcms2.a``    


- build using emscripten code sdk (emsdk)
  - ````bash
    emcc icc_profile.c [path to lcms2]/src/.libs/liblcms2.a \
        -I lcms2-2.15/include \
        -O3 \
        -s MODULARIZE=1 \
        -s EXPORT_ES6=1 \
        -s ENVIRONMENT=web,worker \
        -s ALLOW_MEMORY_GROWTH=1 \
        -s EXPORTED_FUNCTIONS='["_set_icc_profile","_process_image","_malloc","_free"]' \
        -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap"]' \
        -o icc_wasm.mjs
    ````
Note that if you download emscripten sdk from the official site, you can find the binary
file in `[emsdk folder]/upstream/emscripten/emcc`.
Additional arguments might include ``-pthread -s USE_PTHREADS=1 -s PTHREAD_POOL_SIZE=4``, which
is for now not used as we cannot ensure the all resources are COOP/COEP compliant.

Example:
``../../emsdk/upstream/emscripten/emcc icc_profile.c lcms2-2.15/src/*.c -I lcms2-2.15/include -O3 -s MODULARIZE=1 -s EXPORT_ES6=1 -s ENVIRONMENT=web,worker -s ALLOW_MEMORY_GROWTH=1 -s EXPORTED_FUNCTIONS='["_set_icc_profile","_process_image","_malloc","_free"]' -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap"]' -o icc_wasm.mjs   ``
``
emcc icc_profile.c lcms2-2.15/src/.libs/liblcms2.a    -I lcms2-2.15/include     -O3      -s MODULARIZE=1         -s EXPORT_ES6=1         -s ENVIRONMENT=web,worker         -s ALLOW_MEMORY_GROWTH=1         -s EXPORTED_FUNCTIONS='["_set_icc_profile","_process_image","_malloc","_free"]'         -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap"]'         -o icc_wasm.mjs
``