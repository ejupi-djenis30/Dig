import 'package:Dig/reload.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:Dig/history.dart';
import 'package:Dig/home.dart';
import 'package:Dig/settings.dart';
import 'package:Dig/download.dart';
import 'package:Dig/favourite.dart';
import 'package:protocol_controller/gopher_controller.dart';
import 'package:protocol_parser/gopher_parser.dart';

void main() {
  runApp(DigBrowser());
}

class DigBrowser extends StatelessWidget {
  const DigBrowser({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Dig Browser',
      theme: ThemeData(
        primarySwatch: Colors.blue,
      ),
      home: DigHomePage(title: 'Dig Browser'),
    );
  }
}

class DigHomePage extends StatefulWidget {
  DigHomePage({Key? key, required this.title}) : super(key: key);
  final String title;

  @override
  _DigHomePageState createState() => _DigHomePageState();
}

class _DigHomePageState extends State<DigHomePage>
    with SingleTickerProviderStateMixin {
  late HomeWidget homeWidget;
  late SettingsWidget settingsWidget;
  late HistoryWidget historyWidget;
  late DownloadHistoryWidget downloadWidget;
  late FavoritePagesWidget favoritePagesWidget;

  List<String> history = [];
  List<String> preferedPages = [];
  List<String> downloadHistory = [];
  List<TabData> tabData = [];

  late TextEditingController _searchController;
  late TabController _tabController;

  bool isLoading = false;
  bool showAppBar = false;
  bool isFavorite = false;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 5, vsync: this);
    _tabController.addListener(_handleTabCountChanged);
    _searchController = TextEditingController();

    homeWidget = HomeWidget(
      onTabCountChanged: _handleTabCountChanged,
      tabs: tabData,
      searchFunction: _searchGopher,
      preferedTabs: preferedPages,
      changePreferedState: changePreferedState,
      changePreferedStateOn: changePreferedStateOn,
    );
    settingsWidget = SettingsWidget();
    historyWidget =
        HistoryWidget(historyItems: history, searchFunction: _searchGopher);
    downloadWidget = DownloadHistoryWidget(downloadItems: downloadHistory);
    favoritePagesWidget = FavoritePagesWidget(
        favoritePages: preferedPages, searchFunction: _searchGopher);
  }

  void _handleTabCountChanged() {
    bool isFirstTab = _tabController.index == 0;
    bool hasTabs = homeWidget.tabs.isNotEmpty;
    setState(() {
      showAppBar = isFirstTab && hasTabs;
    });
  }

  void changePreferedState() {
    setState(() {
      isFavorite = false;
    });
  }

  void changePreferedStateOn() {
    setState(() {
      isFavorite = true;
    });
  }

  @override
  void dispose() {
    _tabController.dispose();
    _searchController.dispose();
    super.dispose();
  }

  void _startReloadAnimation() {
    setState(() {
      isLoading = true;
    });
  }

  void _stopReloadAnimation() {
    setState(() {
      isLoading = false;
    });
  }

  void _handleKeyEvent(RawKeyEvent event) {
    if (event is RawKeyDownEvent &&
        event.logicalKey == LogicalKeyboardKey.enter &&
        _searchController.text.isNotEmpty) {
      _searchGopher(_searchController.text);
      _searchController.clear();
    }
  }

  void _searchGopher(String url) {
    _startReloadAnimation();
    Uri searchUrl =
        Uri.parse(url.contains("gopher://") ? url : "gopher://" + url);
    GopherController initRequest = GopherController(
        searchUrl.host,
        searchUrl.hasPort ? searchUrl.port : 70,
        searchUrl.hasAbsolutePath ? searchUrl.path : "/",
        GopherController.NONE_SELECTOR);
    initRequest.make_request(searchUrl.query).then((value) {
      GopherParser parser = GopherParser(value);
      List<GopherElement> elements = parser.parse();
      setState(() {
        tabData[homeWidget.tabController.index].title = searchUrl.toString();
        tabData[homeWidget.tabController.index].children = elements;
      });
      history.add(searchUrl.toString());
      _stopReloadAnimation();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: showAppBar
          ? AppBar(
              backgroundColor: Color(0xFF2E2E2E),
              automaticallyImplyLeading: true,
              leading: ReloadButton(
                  isLoading: isLoading,
                  currentUrl:
                      homeWidget.tabs[homeWidget.tabController.index].title,
                  searchFunction: _searchGopher),
              title: RawKeyboardListener(
                focusNode: FocusNode(),
                onKey: _handleKeyEvent,
                child: TextField(
                  controller: _searchController,
                  decoration: InputDecoration(
                    hintText: 'Search',
                    hintStyle: TextStyle(
                      fontFamily: 'Poppins',
                      color: Color(0xFF454545),
                    ),
                    enabledBorder: UnderlineInputBorder(
                      borderSide: BorderSide(
                        color: Color(0xFFE8E8E8),
                        width: 1,
                      ),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    focusedBorder: UnderlineInputBorder(
                      borderSide: BorderSide(
                        color: Color(0xFF5C5C5C),
                        width: 1,
                      ),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    errorBorder: UnderlineInputBorder(
                      borderSide: BorderSide(
                        color: Color(0xFFFF7F7F),
                        width: 1,
                      ),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    focusedErrorBorder: UnderlineInputBorder(
                      borderSide: BorderSide(
                        color: Color(0xFFFF7F7F),
                        width: 1,
                      ),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    filled: true,
                    fillColor: Color(0xFFB9B9B9),
                    suffixIcon: Container(
                      width: 24,
                      height: 24,
                      child: Image.asset(
                        'assets/gopher.png',
                        color: Color(0xFF454545),
                      ),
                    ),
                  ),
                  style: TextStyle(
                    fontFamily: 'Poppins',
                    color: Color(0xFF2E2E2E),
                  ),
                ),
              ),
              actions: [
                IconButton(
                  icon: Icon(
                    isFavorite ? Icons.star : Icons.star_outline_rounded,
                    color: Color(0xFFB9B9B9),
                    size: 24,
                  ),
                  onPressed: () {
                    setState(() {
                      if (preferedPages.contains(homeWidget
                          .tabs[homeWidget.tabController.index].title)) {
                        preferedPages.remove(homeWidget
                            .tabs[homeWidget.tabController.index].title);

                        isFavorite = false;
                      } else {
                        preferedPages.add(homeWidget
                            .tabs[homeWidget.tabController.index].title);
                        isFavorite = true;
                      }
                    });
                  },
                ),
              ],
              centerTitle: true,
              elevation: 4,
            )
          : null,
      body: TabBarView(
        controller: _tabController,
        children: [
          homeWidget,
          historyWidget,
          favoritePagesWidget,
          settingsWidget,
          downloadWidget,
        ],
      ),
      bottomNavigationBar: TabBar(
        controller: _tabController,
        unselectedLabelColor: Color(0xFFB9B9B9),
        labelColor: Color(0xFF2E2E2E),
        indicatorColor: Color(0xFF2E2E2E),
        tabs: [
          Tab(
            icon: Icon(Icons.home),
          ),
          Tab(
            icon: Icon(Icons.history),
          ),
          Tab(
            icon: Icon(Icons.star),
          ),
          Tab(
            icon: Icon(Icons.settings),
          ),
          Tab(
            icon: Icon(Icons.download),
          ),
        ],
      ),
    );
  }
}
