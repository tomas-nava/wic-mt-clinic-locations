# Create lookup

A command-line script that uses the
[Distance Matrix API](https://developers.google.com/maps/documentation/distance-matrix)
to calculate rough distances to a set of locations from each zip code in the state of Montana.

### Prerequisites

1. Install Node.js with [homebrew](https://brew.sh/)
   ```bash
   brew install node
   ```
1. [Get a key for the Google Maps API](https://developers.google.com/maps/documentation/distance-matrix/cloud-setup)

### Running the script

1. clone this repo

    ```bash
    git clone git@github.com:tomas-nava/wic-mt-clinic-locations.git
    ```
1. install packages

    ```bash
    npm install
    ```
1.  make a copy of the config file, and edit your copy to add your API key

    ```bash
    cp config.mjs.example config.mjs
    ```
1. run the script

   ```bash
   node create_lookup.js
   ```

When you run the script, the following JSON files will be created in the `output/` folder:

* `clinics-address-check.json`

  This file shows the clinic address pulled from the JSON file, and how the Google Maps API
  interpreted that address for the purpose of calculating distances. We may want to adjust
  the source addresses if the API's interpretation is not accurate.

* `clinics-with-ids.json`

  This is the list of clinics unchanged except for the addition of an `id` parameter to each.
  These IDs are used to refer to individual clinics in the lookup files.

* `clinics-zip-code-lookup/`

  The lookup files are in this directory. There is one file for each zip code (eg `59001.json`) and
  one file that has all the lookups in one file (`all.json`). Whether it's in the individual files
  or the combined file, the structure is the same: each zip code is associated with a list of
  objects. Each object has an ID that refers to the clinic (see `clinics-with-ids.json`) and a
  distance expressed in miles (eg `"12.5 mi"`). The list is sorted by distance, so the closest
  clinic in a specific zip code is at the top of the list, and the furthest away is at the bottom.
