const Apify = require('apify');
const _ = require('underscore');
const safeEval = require('safe-eval');

Apify.main(async () => {
    const input = await Apify.getInput();
    console.log('Input:');
    console.log(input);

    if (!input || !Array.isArray(input.startUrls) || input.startUrls.length === 0) {
        throw new Error("Invalid input, it needs to contain at least one url in 'startUrls'.");
    }

    let extendOutputFunction;
    if (typeof input.extendOutputFunction === 'string' && input.extendOutputFunction.trim() !== '') {
        try {
            extendOutputFunction = safeEval(input.extendOutputFunction);
        } catch (e) {
            throw new Error(`'extendOutputFunction' is not valid Javascript! Error: ${e}`);
        }
        if (typeof extendOutputFunction !== 'function') {
            throw new Error('extendOutputFunction is not a function! Please fix it or use just default ouput!');
        }
    }

    const dataset = await Apify.openDataset();
    const { itemCount } = await dataset.getInfo();

    let pagesOutputted = itemCount;
    const requestQueue = await Apify.openRequestQueue();

    for (let index = 0; index < input.startUrls.length; index++) {
        await requestQueue.addRequest({ url: input.startUrls[index].url, userData: { label: 'start' } });
    }

    const crawler = new Apify.CheerioCrawler({
        requestQueue,
        handlePageFunction: async ({ request, autoscaledPool, $ }) => {
            if (request.userData.label === 'start' || request.userData.label === 'list') {
                const content = $('meta[name=description]').attr('content').split(/\s+/)[0].replace('.', '').replace(',', '');
                const pageCount = Math.floor(parseInt(content, 10) / 10);

                if (request.userData.label === 'start') {
                    for (let index = 1; index < pageCount; index++) {
                        const startNumber = index * 10;
                        let startUrl = request.url;
                        startUrl += `${startUrl.split('?')[1] ? '&' : '?'}start=${startNumber}`;
                        await requestQueue.addRequest({ url: startUrl, userData: { label: 'list' } });
                    }
                }

                const jobLinks = $('.result');
                for (let index = 1; index < jobLinks.length; index++) {
                    const jk = $(jobLinks[index]).attr('data-jk');
                    await requestQueue.addRequest({ url: `https://vn.indeed.com/viewjob?jk=${jk}`, userData: { label: 'job', jobKey: jk } });
                }
            } else if (request.userData.label === 'job') {
                const jobDesription = $('#jobDescriptionText').text();
                const jobLocation = $('.jobsearch-JobMetadataHeader-iconLabel').text();
                const jobTitle = $('.jobsearch-JobInfoHeader-title').text();

                const pageResult = {
                    url: request.url,
                    id: request.userData.jobKey,
                    positionName: jobTitle,
                    location: jobLocation,
                    description: jobDesription,
                    '#debug': Apify.utils.createRequestDebugInfo(request),
                };

                if (extendOutputFunction) {
                    const userResult = await extendOutputFunction($);
                    _.extend(pageResult, userResult);
                }

                await Apify.pushData(pageResult);

                if (++pagesOutputted >= input.maxItems) {
                    const msg = `Outputted ${pagesOutputted} pages, limit is ${input.maxItems} pages`;
                    console.log(`Shutting down the crawler: ${msg}`);
                    autoscaledPool.abort();
                }
            }
        },

        handleFailedRequestFunction: async ({ request }) => {
            await Apify.pushData({
                '#isFailed': true,
                '#debug': Apify.utils.createRequestDebugInfo(request),
            });
        },

        proxyConfiguration: input.proxyConfiguration,
    });

    await crawler.run();
});
