const path = require("path");
const https = require("https");
const url = require("url");
const cheerio = require("cheerio");
const express = require('express');
const app = express();

function postRequestToCkan(id, offset=0, limit=100, i=0) {
    return new Promise(function(resolve, reject) {
        var postData = JSON.stringify({
            resource_id: id,
            limit: limit,
            offset: offset,
            fields: ["_id", "title2", "description4", "category"].join(),
            sort: [].join(),
            include_total: true,
        });
    
        var options = {
            host: "data.gov.il",
            path: "/api/3/action/datastore_search",
            method: "post",
            headers: {
                // "Content-Type": "application/x-www-form-urlencoded",
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(postData),
                "Transfer-Encoding": "chunked"
            }
        }
    
        var callback = function(response) {
            var apiResponse = [];
            response.on("data", function(chunk) {
                apiResponse = apiResponse.concat(chunk);
            });
            response.on("end", function() {
                // handleApiResponse(apiResponse);
                apiResponse = Buffer.concat(apiResponse);
                apiResponse = JSON.parse(apiResponse);
                const total = apiResponse.result.total;
                let resourceId = apiResponse.result.resource_id;
                // Logically it should be used by the next .then() object in the chain,
                    // but I can't figure out how to chain multiple .then() objects.
                var nextOffset = url.parse(apiResponse.result._links.next, true).query.offset;
                if(i === 0) {
                    resolve([resourceId, total, apiResponse]);
                } else {
                    resolve([apiResponse]);
                }
            });
        }
    
        const requestToCkan = https.request(options, callback);
        requestToCkan.write(postData);
        requestToCkan.end();
    });
}

app.set('view engine', 'ejs');
app.use("/public", express.static("static"));


app.get('/', async function(req, res) {
    const OFFSET = 0; // API default is 0
    const LIMIT = 20;  // API default is 100

    // Searches the dataset(package) object using the CKAN's package_search GET method.
    // Hopefully, only one dataset should be found, since there's only one package with each 
    // package's name.
    // But, in case it founds none, more than one, or any invalid number of packages, it rejects the response.
    try {
        let datasetObject = await new Promise(function(resolve, reject) {
            let queryStrings = {
                q: "tqhe"
            };
            let options = {
                host: "data.gov.il",
                path: ["/api/3/action/package_search", new URLSearchParams(queryStrings).toString()].join("?")
            };
            let callback = function(response) {
                let apiResponse = [];
                response.on("data", function(chunk) {
                    apiResponse = apiResponse.concat(chunk);
                });
                response.on("end", function() {
                    apiResponse = Buffer.concat(apiResponse);
                    apiResponse = JSON.parse(apiResponse);
                    let count = apiResponse.result.count;
                    if (count < 0) {
                        reject(`Invalid number of packages (datasets) found for the query ${query} - less than 0.`);
                    } else if(count === 0) {
                        reject(`No packages(datasets) with the query ${query} found.`);
                    } else if (count === 1) {
                        resolve(apiResponse.result.results[0]);
                    } else {
                        reject(`Too many packages (datasets) found for the query ${query} - greater than 1.`);
                    }
                });
            };
            https.request(options, callback).end();
        });
        
        // datasetObject holds one package(dataset) object.
        // Sanitize if necessary.
        let resources = datasetObject.resources;
        resources = resources.filter(function(resource) {
            return resource.datastore_active;
        });
        let latestResource = resources.reduce(function(currentLatest, currentDate){
            return (currentLatest.last_modified > currentDate.last_modified ? currentLatest : currentDate);
        });
        let id = latestResource.id;
        try {
            let [resourceId, total, apiResponse] = await postRequestToCkan(id, OFFSET, LIMIT);
            total = LIMIT;
            // total = total - OFFSET;
            var apiResponses = [];
            for(var i = 1; i < parseInt(total / LIMIT); i++) {
                apiResponses = apiResponses.concat(postRequestToCkan(resourceId, LIMIT*i + OFFSET, LIMIT, i));
            }
            apiResponses = apiResponses.concat(postRequestToCkan(resourceId, LIMIT*i + OFFSET, total % LIMIT, i));
            try {
                let values = await Promise.all([[apiResponse]].concat(apiResponses));
                // Values - Array of arrays of one object - the API response' objects

                const isSort = false;

                // questions_objects - array of the API response' objects
                let questions_objects = values.map(function(inner_arr) {
                    return inner_arr[0];
                });

                // Extract the records out of the whole API response objects.
                // questions_records - array of arrays of 100 records.
                let questions_records = questions_objects.map(function(questions_object) {
                    return questions_object.result.records;
                });

                // Concat the arrays.
                // questions_records - array of 1802 (or future total) objects.
                questions_records = questions_records.reduce(function(questionsArray, nextQuestionsArray) {
                    return questionsArray.concat(nextQuestionsArray);
                });

                function parseField(field) {
                    return (field !== undefined ? decodeURI(field.trim()).replace(/^"/, "").replace(/"$/, "") : undefined);
                }

                questions_records.forEach(function(records_object, i) {
                    var $ = cheerio.load(records_object.description4);

                    var title2 = questions_records[i].title2.match(/([0-9]{1,4})(\.\s)(.*)/);
                    var questionNumber = parseInt(parseField(title2[1]));
                    var questionTitle = parseField(title2[3]);
                    questions_records[i].questionNumber = questionNumber;
                    questions_records[i].questionTitle = questionTitle;
                    
                    var descriptions = [];
                    var correctAnswer = -1;
                    $("li > span").each(function(j, element) {
                        descriptions = descriptions.concat([parseField($(element).text())]);
                        if("id" in element.attribs) {
                            correctAnswer = j;
                        }
                    });
                    questions_records[i].descriptions = descriptions;
                    questions_records[i].correctAnswer = correctAnswer;

                    questions_records[i].optionalImage = {};
                    questions_records[i].optionalImage.source = parseField($("img").attr("src"));
                    questions_records[i].optionalImage.alt = parseField($("img").attr("alt"));
                    questions_records[i].optionalImage.title = parseField($("img").attr("title"));

                    var vehiclesTypes = parseField($("span:nth-of-type(2)").text());
                    if(/[а-яА-ЯЁё]/.test(vehiclesTypes)) {
                        vehiclesTypes = vehiclesTypes.replace(/\u0412/g, "B");
                        // Implement more replacements if needed.
                    }
                    vehiclesTypes = vehiclesTypes.match(/[A-Z]|[0-9]|[A-Z][0-9]/g);
                    questions_records[i].vehiclesTypes = vehiclesTypes;
                    // Optional regex for the title itself - 
                    // /(?<=[0-9]\.\s)(.|\s)*/
                    // There's no question 713.

                    // Optional, for convenience manners - 
                    // delete questions_records[i].description4;
                });
                if(isSort) {
                    questions_records.sort(function(a, b) {
                        return a.questionNumber - b.questionNumber;
                    });
                }
                res.render('index', {questions: questions_records});
                console.log("Debug");
            } catch (error) {
                console.log(error);
            }
        } catch(error) {
            console.log(error);
        }
    } catch(error) {
        console.log(error);
    }
});

app.listen(5000);