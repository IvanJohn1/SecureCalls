module.exports = {
  project: {
    windows: {
      sourceDir: 'windows',
      solutionFile: 'SecureCallApp.sln',
      project: {
        projectFile: 'SecureCallApp/SecureCallApp.vcxproj', // Укажите vcxproj вместо csproj
      },
    },
  },
};
