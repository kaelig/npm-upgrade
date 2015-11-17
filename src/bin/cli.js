#! /usr/bin/env node

import fs from 'fs';
import path from 'path';

import _ from 'lodash';
import { white } from 'chalk';
import opener from 'opener';
import ncu from 'npm-check-updates';
import { colorizeDiff } from 'npm-check-updates/lib/version-util';

import { getModuleVersion, setModuleVersion, getModuleInfo, getModuleHomepage } from '../packageUtils';
import { fetchRemoteDb, findModuleChangelogUrl } from '../changelogUtils';
import { getRepositoryInfo } from '../repositoryUtils';
import { createSimpleTable } from '../cliTable';
import askUser from '../askUser';

const pkg = require('../../package.json');

const CURRENT_REPOSITORY_ID = getRepositoryInfo(pkg.repository.url).repositoryId;
const DEFAULT_REMOTE_CHANGELOGS_DB_URL = `https://raw.githubusercontent.com/${CURRENT_REPOSITORY_ID}/master/db/changelogUrls.json`;

const strong = white.bold;

(async function main() {
    const packageFile = path.resolve(process.argv[2] || './package.json');
    let packageJson = require(packageFile);

    // Fetching remote changelogs db in background
    // TODO: allow to specify database url as command line argument
    fetchRemoteDb(DEFAULT_REMOTE_CHANGELOGS_DB_URL);

    console.log(`Checking for outdated modules for "${strong(packageFile)}"...`);
    let updatedModules = await ncu.run({ packageFile });

    if (_.isEmpty(updatedModules)) {
        return console.log(`All dependencies are up-to-date!`);
    }

    // Making array of outdated modules
    updatedModules = _.map(updatedModules, (newVersion, moduleName) => ({
        name: moduleName,
        from: getModuleVersion(moduleName, packageJson),
        to: newVersion
    }));

    // Creating pretty-printed CLI table with update info
    const updatedTable = createSimpleTable(
        _.map(updatedModules, ({ name, from, to }) =>
            [strong(name), from, '→', colorizeDiff(to, from)]
        )
    );

    console.log(`\nNew versions of modules available:\n\n${updatedTable}`);

    let packageUpdated = false;
    do {
        const outdatedModule = updatedModules.shift();
        const { name, from, to } = outdatedModule;
        let { changelogUrl, homepage } = outdatedModule;
        console.log('');

        const answer = await askUser({
            type: 'list',
            message: `${changelogUrl === undefined ? 'U' : 'So, u'}pdate "${name}" in package.json ` +
                     `from ${from} to ${colorizeDiff(to, from)}?`,
            choices: _.compact([
                { name: 'Yes', value: true },
                { name: 'No', value: false },
                // Don't show this option if we couldn't find module's changelog url
                (changelogUrl !== null) &&
                    { name: 'Show changelog', value: 'changelog' },
                // Show this if we haven't found changelog
                (changelogUrl === null && homepage !== null) &&
                    { name: 'Open homepage', value: 'homepage' }
            ]),
            // Automatically setting cursor to "Open homepage" after we haven't found changelog
            default: (changelogUrl === null && homepage === undefined) ? 2 : 0
        });

        switch (answer) {
            case 'changelog':
                // Ask user about this module again
                updatedModules.unshift(outdatedModule);

                if (changelogUrl === undefined) {
                    console.log('Trying to find changelog URL...');
                    changelogUrl = outdatedModule.changelogUrl = await findModuleChangelogUrl(name, DEFAULT_REMOTE_CHANGELOGS_DB_URL);
                }

                if (changelogUrl) {
                    console.log(`Opening ${strong(changelogUrl)}...`);
                    opener(changelogUrl);
                } else {
                    console.log(
                        `Sorry, we haven't found changelog URL for ${strong(name)} module.\n` +
                        `It would be great if you could fill an issue about this here: ${strong(pkg.bugs)}\n` +
                        'Thanks a lot!'
                    );
                }
                break;

            case 'homepage':
                // Ask user about this module again
                updatedModules.unshift(outdatedModule);

                if (homepage === undefined) {
                    console.log('Trying to find homepage URL...');
                    homepage = outdatedModule.homepage = getModuleHomepage(await getModuleInfo(name));
                }

                if (homepage) {
                    console.log(`Opening ${strong(homepage)}...`);
                    opener(homepage);
                } else {
                    console.log(`Sorry, there is no info about homepage URL in the ${strong(name)}'s package.json`);
                }
                break;

            case true:
                packageUpdated = true;
                setModuleVersion(name, to, packageJson);
                break;
        }

    } while (updatedModules.length);

    // Adds new line
    console.log('');

    if (packageUpdated) {
        packageJson = JSON.stringify(packageJson, null, 2);
        console.log(`New package.json:\n\n${packageJson}\n`);
        const shouldUpdatePackageFile = await askUser(
            { type: 'confirm', message: 'Update package.json?', default: true }
        );

        if (shouldUpdatePackageFile) {
            // Adding newline to the end of file
            fs.writeFileSync(packageFile, `${packageJson}\n`);
        }
    } else {
        console.log('Nothing to update');
    }
})().catch(err => {
    console.error(err.stack);
    process.exit(1);
});
