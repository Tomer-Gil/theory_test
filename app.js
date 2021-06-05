const path = require("path");
const https = require("https");
const url = require("url");
const cheerio = require("cheerio");
const express = require('express');
const app = express();

function handleApiResponse(api_response, i=0) {
    api_response = JSON.parse(api_response);
    const total = api_response.result.total;
    var next_offset = url.parse(api_response.result._links.next, true).query.offset;
    console.log(total);
    if(i == 0) {
        questions = questions.concat(["tomer"]);
    }
    console.log(questions);
}

function postRequestToCkan(limit, i, offset=0) {
    return new Promise(function(resolve, reject) {
        var post_data = JSON.stringify({
            resource_id: "bf7cb748-f220-474b-a4d5-2d59f93db28d",
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
                "Content-Length": Buffer.byteLength(post_data),
                "Transfer-Encoding": "chunked"
            }
        }
    
        var callback = function(response) {
            var api_response = [];
            response.on("data", function(chunk) {
                api_response = api_response.concat(chunk);
            });
            response.on("end", function() {
                // handleApiResponse(api_response);
                api_response = Buffer.concat(api_response);
                api_response = JSON.parse(api_response);
                const total = api_response.result.total;
                let resourceId = api_response.result.resource_id;
                // Logically it should be used by the next .then() object in the chain,
                    // but I can't figure out how to chain multiple .then() objects.
                var nextOffset = url.parse(api_response.result._links.next, true).query.offset;
                if(i === 0) {
                    resolve([total, api_response]);
                } else {
                    resolve([api_response]);
                }
            });
        }
    
        const request_to_ckan = https.request(options, callback);
        request_to_ckan.write(post_data);
        request_to_ckan.end();
    });
}

app.set('view engine', 'ejs');
app.use("/public", express.static("static"));


app.get("/", function(req, res) {
    // console.log(path.join(__dirname,"public"));
    // console.log(__dirname + "/public")
    const LIMIT = 100;  // API default
    var i = 0;
    postRequestToCkan(LIMIT, 0).then(function(success) {
        [total, apiResponse] = success;
        var apiResponses = [];
        var i;
        for(i = 1; i < parseInt(total / LIMIT); i++) {
            apiResponses = apiResponses.concat(postRequestToCkan(LIMIT, i, offset=LIMIT*i));
        }
        apiResponses = apiResponses.concat(postRequestToCkan(total % i, i, LIMIT*i));
        Promise.all([[apiResponse]].concat(apiResponses)).then((values) => {
            // Values - Array of arrays of one object - the API response' objects

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

            questions_records.forEach(function(records_object, i) {
                var $ = cheerio.load(records_object.description4);
                var descriptions = [];
                var correctAnswer = -1;
                $("li > span").each(function(j, element) {
                    descriptions = descriptions.concat([$(element).text()]);
                    if("id" in element.attribs) {
                        correctAnswer = j;
                    }
                });
                questions_records[i].descriptions = descriptions;
                questions_records[i].correctAnswer = correctAnswer;

                questions_records[i].optionalImage = {};
                questions_records[i].optionalImage.source = $("img").attr("src");
                questions_records[i].optionalImage.alt = $("img").attr("alt");
                questions_records[i].optionalImage.title = $("img").attr("title");

                var vehiclesTypes = $("span:nth-of-type(2)").text().match(/[A-Z]|[0-9]|[A-Z][0-9]/g);
                questions_records[i].vehiclesTypes = vehiclesTypes;

                var title2 = questions_records[i].title2.match(/([0-9]{1,4})(\.\s)(.*)/);
                var questionNumber = title2[1];
                var questionTitle = title2[3];
                questions_records[i].questionNumber = parseInt(questionNumber);
                questions_records[i].questionTitle = questionTitle;
                // Optional regex for the title itself - 
                // /(?<=[0-9]\.\s)(.|\s)*/

                // Optional, for convenience manners - 
                // delete questions_records[i].description4;
            });
/*             questions_records.sort(function(a, b) {
                return a.questionNumber - b.questionNumber;
            }); */
            questions_records.forEach(function(question_record, index) {
                if(question_record.vehiclesTypes === null) {
                    console.log(index + " vehiclesTypes is null.");
                }
            });
            res.render('original', {questions: questions_records});
            console.log("Debug");
        });
    }, function(error) {});
});

app.listen(5000);