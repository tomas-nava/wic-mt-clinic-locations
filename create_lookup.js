import { config } from './config.mjs';
import { Client } from "@googlemaps/google-maps-services-js";
import fetch from 'node-fetch';
import fs from 'fs';

// get the clinics JSON from GitHub
const clinicsUrl = "https://raw.githubusercontent.com/navapbc/" +
                   "wic-mt-demo-project-eligibility-screener/" +
                   "4cb9a3fee1366175a8ea8323924b61f4d308e9d8/app/public/data/clinics.json"
const clinics = await fetch(clinicsUrl).then((response) => response.json())

// add ID numbers to the clinics and output the result
const clinicsWithIds = clinics.map((clinic, index) => ({id: index, ...clinic}))
fs.writeFile('output/clinics-with-ids.json', JSON.stringify(clinicsWithIds, null, 4), (err) => {
    if (err) throw err;
});

// the distance matrix API can only take 25 addresses at a time, so we'll
// split the clinics list into chunks of 25
const clinicsChunks = [];
const chunkSize = 25;
for (let i = 0; i < clinicsWithIds.length; i += chunkSize) {
  clinicsChunks.push(clinicsWithIds.slice(i, i + chunkSize));
}

// these are the shapes of all of Montana's zip codes, along with some
// extra useful data. This is data generated by the Census Bureau.
// downloaded from: https://redistrictingdatahub.org/dataset/montana-zcta5-boundaries-2020/
// and converted to geojson at mapshaper.org
const zipShapes = JSON.parse(fs.readFileSync('data/mt_zcta_20_bound-geo.json', 'utf8'));

// each record in zipShapes has "internal points" which are the Census Bureau's
// best guess at a center point for that zip code in latitude and longitude.
// Extract just the zip code plus that center point into a new array.
const zipsWithCentroids = zipShapes.features.map(
  (zip) => ({
    zipCode: zip.properties.ZCTA5CE10,
    lat: zip.properties.INTPTLAT10.replace(/^\+/g, ''), // remove leading '+'
    lon: zip.properties.INTPTLON10
  })
).filter((obj) => obj.zipCode.startsWith('59')); // filter out non-MT zip codes

// some alternate center locations for zip codes whose centroids can't be resolved
// into a street address by the maps API
const alternateCentroids = {
  '59020': 'Cooke City, MT 59020',
  '59028': '1049 Nye Rd, Fishtail, MT 59028',
  '59039': '403 1st Ave, Ingomar, MT 59039',
  '59061': '1982 Nye Rd, Nye, MT 59061',
  '59068': '6380 US-212, Red Lodge, MT 59068',
  '59311': '13681 US-212, Alzada, MT 59311',
  '59631': 'Boulder River Rd, Basin, MT 59631',
  '59639': '4388 Snow Drift Ln, Lincoln, MT 59639',
  '59711': '50 Theater Ln, Anaconda, MT 59711',
  '59716': '47995 Gallatin Road Suite 101 Gallatin Gateway, Big Sky, MT 59716',
  '59762': 'Wise River, MT 59762',
};

// initialize the google maps API service
const client = new Client({});

// this function will call the distance matrix service with the
// options passed to it (adding the API key) and return the result.
const loadMatrix = async (options) => {
  try {
    return await client.distancematrix({ params: { key: config.google.api_key, ...options } });
  } catch (error) {
    console.log('error loading matrix!');
    return {};
  }
}

// a function to return clinic distances for a single zip code; adds a list
// of objects with a clinic's id number and its distance from that zip code's
// internal point. The list is sorted by distance with the closest clinic first, eg:
// {59701: [{id: 30, distance: "2.5 mi"}, {id: 12, distance: "3 mi"}, etc...]
const distancesForZip = async (zip) => {
  let distances = [];
  for (let chunk of clinicsChunks) {
    // the options to pass to the distance matrix service
    const altCentroid = alternateCentroids[zip.zipCode];
    const zipOrigin = altCentroid || `${zip.lat},${zip.lon}`
    let options = ({
      origins: [zipOrigin],
      destinations: chunk.map((clinic) => clinic.clinicAddress),
      mode: 'driving',
      units: 'imperial',
    });
    // send the request
    console.log(`...sending chunk for (${zip.zipCode})`);
    let matrix = await loadMatrix(options);
    // transform the result into the format we want
    // I'm including some extra values so we can check our
    // results for accuracy, including how the API interprets
    // the clinic addresses we pass
    let transformed = chunk.map((clinic, index) => {
      // our origin point/centroid may be invalid?
      if (
        Object.entries(matrix).length === 0 ||
        matrix.data.rows[0].elements[index].status === 'ZERO_RESULTS'
      ) {
        console.log(`zero results from origin ${matrix.data.origin_addresses[0]}`);
        return {};
      }


      try {
        return ({
          id: clinic.id,
          distance: matrix.data.rows[0].elements[index].distance.text,
          distanceValue: matrix.data.rows[0].elements[index].distance.value,
          duration: matrix.data.rows[0].elements[index].duration.text,
          inputAddress: clinic.clinicAddress,
          parsedAddress: matrix.data.destination_addresses[index],
        });
      } catch (error) {
        console.log('error reading matrix data!');
        return {};
      }
    }).filter((val) => Object.entries(val).length !== 0); // filter to remove empty values

    // concat the results for this chunk onto the list
    distances = distances.concat(transformed);
  }

  // sort the array for this zip by distance
  distances.sort((a, b) => a.distanceValue - b.distanceValue);

  return distances;
}

// how many zip codes are we going to build the lookup for?
const offset = Math.min(0, zipsWithCentroids.length);
const limit = zipsWithCentroids.length;
// const offset = Math.min(96, zipsWithCentroids.length);
// const limit = Math.min(offset + 2, zipsWithCentroids.length);

// get all the distances synchronously
const distances = []
for (const zip of zipsWithCentroids.slice(offset, limit)) {
  console.log(`starting ${zip.zipCode}`);
  distances.push(await distancesForZip(zip));
};

// create the lookup object and the address comparison object
const lookup = {};
let addressCheck = [];
for (let i = offset; i < limit; i++) {
  let zip = zipsWithCentroids[i];
  // populate addressCheck if it hasn't been already
  if (addressCheck.length === 0) {
    addressCheck = distances[i - offset].map((item) => ({
      id: item.id, inputAddress: item.inputAddress, parsedAddress: item.parsedAddress
    }));
    addressCheck.sort((a, b) => a.id - b.id);
  }

  // add the lookup for this zip code
  lookup[zip.zipCode] = distances[i - offset].map((item) => ({
    id: item.id, distance: item.distance
  }));

  // write a file with just the info for this zip code
  fs.writeFile(
    `output/clinics-zip-code-lookup/${zip.zipCode}.json`,
    JSON.stringify(lookup[zip.zipCode], null, 4),
    (err) => { if (err) throw err; });
}

// write the address comparisons to a file
fs.writeFile('output/clinics-address-check.json', JSON.stringify(addressCheck, null, 4), (err) => {
    if (err) throw err;
});

// write all the zip code lookups to one file
fs.writeFile('output/clinics-zip-code-lookup/all.json', JSON.stringify(lookup, null, 4), (err) => {
    if (err) throw err;
});
