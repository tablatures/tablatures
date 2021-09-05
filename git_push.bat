# git subtree split --prefix dist -b gh-pages
# git subtree push --prefix dist origin gh-pages:master
# git subtree push origin gh-pages:master
# git branch -D gh-pages
git merge -s subtree origin/gh-pages
git push --set-upstream origin master
git subtree push --prefix dist origin gh-pages
git push origin e5018b8dcb1e6d8e367145ee03da5dee06003e72:gh-pages --force